import type { ResultAsync } from 'neverthrow'
import type { RepositoryError } from './repository-error'

export interface ConversationRepository {
  create(userId: string): ResultAsync<{ id: string }, RepositoryError>
  // 会話が存在し、かつそのユーザーのものか
  isOwnedBy(key: { conversationId: string; userId: string }): ResultAsync<boolean, RepositoryError>
}
