import type { Result } from '@/domain/result'
import type { RepositoryError } from './repository-error'

export interface UserRepository {
  exists(userId: string): Promise<Result<boolean, RepositoryError>>
}
