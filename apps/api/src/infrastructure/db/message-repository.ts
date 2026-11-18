import { and, eq } from 'drizzle-orm'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import type { MessageRepository } from '@/usecases/ports/message-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'
import type { DbExecutor } from './client'
import { assistantMessages, userMessages } from './schema'

const toRepositoryError = (cause: unknown): RepositoryError => ({ type: 'database_error', cause })

export const createMessageRepository = (db: DbExecutor): MessageRepository => ({
  createUserMessage: (message) =>
    ResultAsync.fromPromise(
      db
        .insert(userMessages)
        .values({ ...message, status: 'generating' })
        // 衝突したら何もせず 0 行を返す（例外にしないので Tx を壊さない）
        .onConflictDoNothing({
          target: [userMessages.conversationId, userMessages.clientMessageId],
        })
        .returning({ id: userMessages.id }),
      toRepositoryError,
    ).andThen(([row]) =>
      row ? okAsync(row) : errAsync({ type: 'duplicate_client_message' as const }),
    ),

  findByClientMessageId: ({ conversationId, clientMessageId }) =>
    ResultAsync.fromPromise(
      db
        .select({
          id: userMessages.id,
          replyId: assistantMessages.id,
          replyContent: assistantMessages.content,
        })
        .from(userMessages)
        .leftJoin(assistantMessages, eq(assistantMessages.userMessageId, userMessages.id))
        .where(
          and(
            eq(userMessages.conversationId, conversationId),
            eq(userMessages.clientMessageId, clientMessageId),
          ),
        ),
      toRepositoryError,
    ).map(([row]) => {
      if (!row) return null
      const { id, replyId, replyContent } = row
      const reply =
        replyId !== null && replyContent !== null ? { id: replyId, content: replyContent } : null
      return { id, reply }
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
