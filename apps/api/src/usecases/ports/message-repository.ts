import type { ResultAsync } from 'neverthrow'
import type { RepositoryError } from './repository-error'

export type NewUserMessage = {
  conversationId: string
  clientMessageId: string
  content: string
}

// 同じ会話・同じ client_message_id の送信がすでにある（UNIQUE (conversation_id, client_message_id)）
export type DuplicateClientMessageError = { type: 'duplicate_client_message' }

export type SentMessage = {
  id: string
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
  // 応答を保存し、送信を「完了」にする
  complete(reply: {
    userMessageId: string
    content: string
  }): ResultAsync<{ id: string }, RepositoryError>
}
