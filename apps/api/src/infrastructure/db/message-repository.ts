import { eq } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import type { MessageRepository } from '@/usecases/ports/message-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'
import type { Db } from './client'
import { assistantMessages, userMessages } from './schema'

const toRepositoryError = (cause: unknown): RepositoryError => ({ type: 'database_error', cause })

export const createMessageRepository = (db: Db): MessageRepository => ({
  createUserMessage: (message) =>
    ResultAsync.fromPromise(
      db
        .insert(userMessages)
        .values({ ...message, status: 'generating' })
        .returning({ id: userMessages.id }),
      toRepositoryError,
    ).map(([row]) => {
      if (!row) throw new Error('user_messages の INSERT が行を返しませんでした')
      return row
    }),

  // 応答の INSERT と送信の状態更新は同じ Tx で行う（片方だけ反映されないように）
  complete: ({ userMessageId, content }) =>
    ResultAsync.fromPromise(
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(assistantMessages)
          .values({ userMessageId, content })
          .returning({ id: assistantMessages.id })
        if (!row) throw new Error('assistant_messages の INSERT が行を返しませんでした')
        await tx
          .update(userMessages)
          .set({ status: 'completed' })
          .where(eq(userMessages.id, userMessageId))
        return row
      }),
      toRepositoryError,
    ),
})
