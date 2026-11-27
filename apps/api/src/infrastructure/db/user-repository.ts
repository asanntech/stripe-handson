import { eq } from 'drizzle-orm'
import type { UserRepository } from '@/usecases/ports/user-repository'
import type { DbExecutor } from './client'
import { users } from './schema'

export const createUserRepository = (db: DbExecutor): UserRepository => ({
  exists: async (userId) => {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId))
    return rows.length > 0
  },
})
