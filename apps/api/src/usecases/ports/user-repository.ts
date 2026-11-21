import type { ResultAsync } from 'neverthrow'
import type { RepositoryError } from './repository-error'

export interface UserRepository {
  exists(userId: string): ResultAsync<boolean, RepositoryError>
}
