import type { ResultAsync } from 'neverthrow'
import type { RepositoryError } from './repository-error'

export interface ConversationRepository {
  create(userId: string): ResultAsync<{ id: string }, RepositoryError>
}
