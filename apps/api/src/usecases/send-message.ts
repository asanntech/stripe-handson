import type { LlmClient } from '@/usecases/ports/llm-client'
import type { MessageRepository, NewUserMessage } from '@/usecases/ports/message-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'

// 第 1 章では固定値（第 2 章で単価表のモデル、第 4 章で残高から max_tokens を算出する）
const MODEL = 'fake-model'
const MAX_TOKENS = 1024

export type SendMessageError = RepositoryError

// delta を 0 回以上流したあと、done か error のどちらか 1 つで終わる（エラーは throw せず値で返す）
export type SendMessageEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; error: SendMessageError }

// 受付（送信を「生成中」で INSERT）→ LLM のストリーミング（DB Tx の外）→ 完了の保存
export async function* sendMessage(
  deps: { messages: MessageRepository; llm: LlmClient },
  input: NewUserMessage,
): AsyncGenerator<SendMessageEvent> {
  const accepted = await deps.messages.createUserMessage(input)
  if (accepted.isErr()) {
    yield { type: 'error', error: accepted.error }
    return
  }

  let response = ''
  for await (const event of deps.llm.stream({
    model: MODEL,
    prompt: input.content,
    maxTokens: MAX_TOKENS,
  })) {
    if (event.type === 'delta') {
      response += event.text
      yield event
    }
  }

  const completed = await deps.messages.complete({
    userMessageId: accepted.value.id,
    content: response,
  })
  if (completed.isErr()) {
    yield { type: 'error', error: completed.error }
    return
  }
  yield { type: 'done', messageId: completed.value.id }
}
