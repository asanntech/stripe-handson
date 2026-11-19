import type { LlmClient } from '@/usecases/ports/llm-client'
import type { MessageRepository, NewUserMessage } from '@/usecases/ports/message-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'

// 第 1 章では固定値（第 2 章で単価表のモデル、第 4 章で残高から max_tokens を算出する）
const MODEL = 'fake-model'
const MAX_TOKENS = 1024

// message_in_progress: 同じ client_message_id の送信が生成中で、返せる応答がない
export type SendMessageError = RepositoryError | { type: 'message_in_progress' }

// delta を 0 回以上流したあと、done か error のどちらか 1 つで終わる（エラーは throw せず値で返す）
export type SendMessageEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; error: SendMessageError }

type Deps = { messages: MessageRepository; llm: LlmClient }

// 受付（送信を「生成中」で INSERT）→ LLM のストリーミング（DB Tx の外）→ 完了の保存
export async function* sendMessage(
  deps: Deps,
  input: NewUserMessage,
): AsyncGenerator<SendMessageEvent> {
  const accepted = await deps.messages.createUserMessage(input)
  if (accepted.isOk()) {
    yield* generateReply(deps, accepted.value.id, input.content)
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
      yield* generateReply(deps, existing.id, input.content)
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
  let response = ''
  for await (const event of deps.llm.stream({ model: MODEL, prompt, maxTokens: MAX_TOKENS })) {
    if (event.type === 'delta') {
      response += event.text
      yield event
    }
  }

  const completed = await deps.messages.complete({ userMessageId, content: response })
  if (completed.isErr()) {
    yield { type: 'error', error: completed.error }
    return
  }
  yield { type: 'done', messageId: completed.value.id }
}
