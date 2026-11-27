import { and, eq } from 'drizzle-orm'
import { ok } from '@/domain/result'
import type { ConversationRepository } from '@/usecases/ports/conversation-repository'
import type { DbExecutor } from './client'
import { conversations } from './schema'
import { tryQuery } from './try-query'

export const createConversationRepository = (db: DbExecutor): ConversationRepository => ({
  create: async (userId) => {
    const rows = await tryQuery(
      db.insert(conversations).values({ userId }).returning({ id: conversations.id }),
    )
    if (!rows.ok) return rows
    const [row] = rows.value
    if (!row) throw new Error('conversations の INSERT が行を返しませんでした')
    return ok(row)
  },

  isOwnedBy: async ({ conversationId, userId }) => {
    const rows = await tryQuery(
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
    )
    if (!rows.ok) return rows
    return ok(rows.value.length > 0)
  },
})
