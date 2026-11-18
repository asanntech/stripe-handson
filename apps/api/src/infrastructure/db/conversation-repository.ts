import { ResultAsync } from 'neverthrow'
import type { ConversationRepository } from '@/usecases/ports/conversation-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'
import type { Db } from './client'
import { conversations } from './schema'

export const createConversationRepository = (db: Db): ConversationRepository => ({
  create: (userId) =>
    ResultAsync.fromPromise(
      db.insert(conversations).values({ userId }).returning({ id: conversations.id }),
      (cause): RepositoryError => ({ type: 'database_error', cause }),
    ).map(([row]) => {
      if (!row) throw new Error('conversations の INSERT が行を返しませんでした')
      return row
    }),
})
