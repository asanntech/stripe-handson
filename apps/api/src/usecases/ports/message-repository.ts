import type { ResultAsync } from 'neverthrow'
import type { RepositoryError } from './repository-error'

export type NewUserMessage = {
  conversationId: string
  clientMessageId: string
  content: string
}

// 同じ会話・同じ client_message_id の送信がすでにある（UNIQUE (conversation_id, client_message_id)）
export type DuplicateClientMessageError = { type: 'duplicate_client_message' }

// 同じ送信の応答がすでに保存されている（UNIQUE (user_message_id)）
export type DuplicateReplyError = { type: 'duplicate_reply' }

export type SentMessage = {
  id: string
  status: 'generating' | 'completed' | 'failed'
  // 応答は完了したときだけある
  reply: { id: string; content: string } | null
}

export interface MessageRepository {
  // 送信を「生成中」として受け付ける
  createUserMessage(
    message: NewUserMessage,
  ): ResultAsync<{ id: string }, RepositoryError | DuplicateClientMessageError>
  findByClientMessageId(key: {
    conversationId: string
    clientMessageId: string
  }): ResultAsync<SentMessage | null, RepositoryError>
  // 「失敗」の送信を「生成中」に戻す（条件付き UPDATE）。同時に呼ばれても true になるのは 1 つだけ
  claimFailedForRetry(userMessageId: string): ResultAsync<boolean, RepositoryError>
  // 「生成中」の送信を「失敗」にする（応答を保存できずに生成が終わったとき）
  markFailed(userMessageId: string): ResultAsync<void, RepositoryError>
  // 応答を保存し、送信を「完了」にする
  complete(reply: {
    userMessageId: string
    content: string
  }): ResultAsync<{ id: string }, RepositoryError | DuplicateReplyError>
}
