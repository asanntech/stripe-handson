import type { ResultAsync } from 'neverthrow'
import type { RepositoryError } from './repository-error'

export type NewUserMessage = {
  conversationId: string
  clientMessageId: string
  content: string
}

export interface MessageRepository {
  // 送信を「生成中」として受け付ける
  createUserMessage(message: NewUserMessage): ResultAsync<{ id: string }, RepositoryError>
  // 応答を保存し、送信を「完了」にする
  complete(reply: {
    userMessageId: string
    content: string
  }): ResultAsync<{ id: string }, RepositoryError>
}
