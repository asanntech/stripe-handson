import { and, eq } from 'drizzle-orm'
import type { ConversationRepository } from '@/usecases/ports/conversation-repository'
import type { DbExecutor } from './client'
import { conversations } from './schema'

export const createConversationRepository = (db: DbExecutor): ConversationRepository => ({
  create: async (userId) => {
    const [row] = await db
      .insert(conversations)
      .values({ userId })
      .returning({ id: conversations.id })
    if (!row) throw new Error('conversations の INSERT が行を返しませんでした')
    return row
  },

  isOwnedBy: async ({ conversationId, userId }) => {
    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    return rows.length > 0
  },
})
