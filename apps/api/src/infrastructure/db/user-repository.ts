import { eq } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import type { RepositoryError } from '@/usecases/ports/repository-error'
import type { UserRepository } from '@/usecases/ports/user-repository'
import type { DbExecutor } from './client'
import { users } from './schema'

export const createUserRepository = (db: DbExecutor): UserRepository => ({
  exists: (userId) =>
    ResultAsync.fromPromise(
      db.select({ id: users.id }).from(users).where(eq(users.id, userId)),
      (cause): RepositoryError => ({ type: 'database_error', cause }),
    ).map((rows) => rows.length > 0),
})
