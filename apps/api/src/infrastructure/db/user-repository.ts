import { eq } from 'drizzle-orm'
import { ok } from '@/domain/result'
import type { UserRepository } from '@/usecases/ports/user-repository'
import type { DbExecutor } from './client'
import { users } from './schema'
import { tryQuery } from './try-query'

export const createUserRepository = (db: DbExecutor): UserRepository => ({
  exists: async (userId) => {
    const rows = await tryQuery(db.select({ id: users.id }).from(users).where(eq(users.id, userId)))
    if (!rows.ok) return rows
    return ok(rows.value.length > 0)
  },
})
