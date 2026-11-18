import type { ResultAsync } from 'neverthrow'

export type RepositoryError = { type: 'database_error'; cause: unknown }

export interface ConversationRepository {
  create(userId: string): ResultAsync<{ id: string }, RepositoryError>
}
