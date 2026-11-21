import { and, eq } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import type { ConversationRepository } from '@/usecases/ports/conversation-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'
import type { DbExecutor } from './client'
import { conversations } from './schema'

export const createConversationRepository = (db: DbExecutor): ConversationRepository => ({
  create: (userId) =>
    ResultAsync.fromPromise(
      db.insert(conversations).values({ userId }).returning({ id: conversations.id }),
      (cause): RepositoryError => ({ type: 'database_error', cause }),
    ).map(([row]) => {
      if (!row) throw new Error('conversations の INSERT が行を返しませんでした')
      return row
    }),

  isOwnedBy: ({ conversationId, userId }) =>
    ResultAsync.fromPromise(
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
      (cause): RepositoryError => ({ type: 'database_error', cause }),
    ).map((rows) => rows.length > 0),
})
