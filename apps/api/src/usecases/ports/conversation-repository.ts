import type { Result } from '@/domain/result'
import type { RepositoryError } from './repository-error'

export interface ConversationRepository {
  create(userId: string): Promise<Result<{ id: string }, RepositoryError>>
  // 会話が存在し、かつそのユーザーのものか
  isOwnedBy(key: {
    conversationId: string
    userId: string
  }): Promise<Result<boolean, RepositoryError>>
}
