import { calculateCredits } from '@/domain/credit'
import type { ConversationRepository } from '@/usecases/ports/conversation-repository'
import type { LlmClient, LlmError, LlmUsage } from '@/usecases/ports/llm-client'
import type {
  DuplicateReplyError,
  MessageRepository,
  NewUserMessage,
} from '@/usecases/ports/message-repository'
import type { ModelPriceRepository } from '@/usecases/ports/model-price-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'
import { runDetached } from './run-detached'

// モデルは単一（クライアントからの選択はスコープ外）。max_tokens は第 4 章で残高から算出する
export const MODEL = 'fake-model'
const MAX_TOKENS = 1024

// conversation_not_found: 会話が存在しないか、他人の会話（存在を知らせないため区別しない）
// llm_unavailable: LLM のストリームが途中で切れ、応答も usage も得られなかった
// message_in_progress: 同じ client_message_id の送信が生成中で、返せる応答がない
// duplicate_reply: 応答の二重保存を DB 制約が止めた（再送の排他をすり抜けたバグなので 500 にする）
// model_price_not_found: モデルの単価が登録されていない（設定の不備なので 500 にする）
export type SendMessageError =
  | RepositoryError
  | DuplicateReplyError
  | { type: 'model_price_not_found'; model: string }
  | { type: 'conversation_not_found' }
  | { type: 'llm_unavailable'; cause: LlmError }
  | { type: 'message_in_progress' }

// delta を 0 回以上流したあと、done か error のどちらか 1 つで終わる（エラーは throw せず値で返す）
export type SendMessageEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; error: SendMessageError }

type Deps = {
  conversations: ConversationRepository
  messages: MessageRepository
  modelPrices: ModelPriceRepository
  llm: LlmClient
}

// 会話の持ち主の確認 → 受付（送信を「生成中」で INSERT）→ LLM のストリーミング（DB Tx の外）→ 完了の保存
export async function* sendMessage(
  deps: Deps,
  input: NewUserMessage & { userId: string },
): AsyncGenerator<SendMessageEvent> {
  const owned = await deps.conversations.isOwnedBy(input)
  if (owned.isErr()) {
    yield { type: 'error', error: owned.error }
    return
  }
  if (!owned.value) {
    yield { type: 'error', error: { type: 'conversation_not_found' } }
    return
  }

  const accepted = await deps.messages.createUserMessage(input)
  if (accepted.isOk()) {
    yield* runDetached(generateReply(deps, accepted.value.id, input.content))
    return
  }
  if (accepted.error.type === 'duplicate_client_message') {
    yield* handleDuplicate(deps, input)
    return
  }
  yield { type: 'error', error: accepted.error }
}

// 同じ client_message_id の送信がすでにあるとき: 状態に応じて 応答を返す / 再生成する / 生成中として拒否する
async function* handleDuplicate(
  deps: Deps,
  input: NewUserMessage,
): AsyncGenerator<SendMessageEvent> {
  const found = await deps.messages.findByClientMessageId(input)
  if (found.isErr()) {
    yield { type: 'error', error: found.error }
    return
  }
  const existing = found.value
  if (existing === null) {
    // 衝突した直後に行が消えることはない（削除しない）ため、ここに来たらバグ
    throw new Error('client_message_id が衝突したのに既存の送信が見つかりません')
  }

  if (existing.reply !== null) {
    // 完了済み: LLM を呼ばず、保存済みの応答を 1 つの delta にまとめて返す
    yield { type: 'delta', text: existing.reply.content }
    yield { type: 'done', messageId: existing.reply.id }
    return
  }
  if (existing.status === 'failed') {
    const claimed = await deps.messages.claimFailedForRetry(existing.id)
    if (claimed.isErr()) {
      yield { type: 'error', error: claimed.error }
      return
    }
    if (claimed.value) {
      // 同じ client_message_id は同じ送信なので、保存済みの本文で再生成する（保存したプロンプトと応答を対応させる）
      yield* runDetached(generateReply(deps, existing.id, existing.content))
      return
    }
    // 他の再送が先に「生成中」へ戻した
  }
  yield { type: 'error', error: { type: 'message_in_progress' } }
}

async function* generateReply(
  deps: Deps,
  userMessageId: string,
  prompt: string,
): AsyncGenerator<SendMessageEvent> {
  // 送信の最終状態（完了 / 失敗）を保存したか
  let settled = false
  // 応答を保存できずに終わるとき、「失敗」を保存してからエラーを返す。
  // 先にエラーを返すと、クライアントがすぐ再送したときにまだ「生成中」で 409 になってしまう。
  // 失敗にできなかった場合は生成中のまま残る（スコープ外の「生成中のまま残った送信の回収」と同じ扱い）
  const fail = async (error: SendMessageError): Promise<SendMessageEvent> => {
    await deps.messages.markFailed(userMessageId)
    settled = true
    return { type: 'error', error }
  }

  try {
    // 生成を始める時点の単価を、完了時の利用記録に固定する
    const price = await deps.modelPrices.findEffective({ model: MODEL, at: new Date() })
    if (price.isErr()) {
      yield await fail(price.error)
      return
    }
    if (price.value === null) {
      // 単価がないと利用を記録できないので、LLM を呼ぶ前に失敗させる
      yield await fail({ type: 'model_price_not_found', model: MODEL })
      return
    }

    let response = ''
    let usage: LlmUsage | null = null
    for await (const event of deps.llm.stream({ model: MODEL, prompt, maxTokens: MAX_TOKENS })) {
      if (event.type === 'delta') {
        response += event.text
        yield event
      }
      if (event.type === 'done') usage = event.usage
      if (event.type === 'error') {
        // 途中までの応答は保存しない（同じ ID で再送すれば再生成できる）
        yield await fail({ type: 'llm_unavailable', cause: event.error })
        return
      }
    }

    // LlmClient は error で終わらなければ必ず done で終わる（usage がないのは実装のバグ）
    if (usage === null) throw new Error('LLM のストリームが done を返さずに終わりました')

    const saved = await deps.messages.complete({
      userMessageId,
      content: response,
      usage: {
        modelPriceId: price.value.id,
        ...usage,
        credits: calculateCredits(usage, price.value),
      },
    })
    if (saved.isErr()) {
      yield await fail(saved.error)
      return
    }
    settled = true
    yield { type: 'done', messageId: saved.value.id }
  } finally {
    // 想定外の例外で抜けたときも、生成中のまま残さない
    if (!settled) await deps.messages.markFailed(userMessageId)
  }
}
