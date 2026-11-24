import { and, eq } from 'drizzle-orm'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import type { MessageRepository } from '@/usecases/ports/message-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'
import type { DbExecutor } from './client'
import { assistantMessages, usageRecords, userMessages } from './schema'

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
          status: userMessages.status,
          content: userMessages.content,
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
      const { id, status, content, replyId, replyContent } = row
      const reply =
        replyId !== null && replyContent !== null ? { id: replyId, content: replyContent } : null
      return { id, status, content, reply }
    }),

  // WHERE に status = 'failed' を含めるので、同時に実行されても先に行ロックを取った 1 つだけが更新できる
  // （後続は先行のコミットを待ってから条件を再評価し、0 行になる）
  claimFailedForRetry: (userMessageId) =>
    ResultAsync.fromPromise(
      db
        .update(userMessages)
        .set({ status: 'generating' })
        .where(and(eq(userMessages.id, userMessageId), eq(userMessages.status, 'failed')))
        .returning({ id: userMessages.id }),
      toRepositoryError,
    ).map((rows) => rows.length === 1),

  markFailed: (userMessageId) =>
    ResultAsync.fromPromise(
      db
        .update(userMessages)
        .set({ status: 'failed' })
        .where(and(eq(userMessages.id, userMessageId), eq(userMessages.status, 'generating'))),
      toRepositoryError,
    ).map(() => undefined),

  // 応答・利用記録の INSERT と送信の状態更新は同じ Tx で行う（一部だけ反映されないように）
  complete: ({ userMessageId, content, usage }) =>
    ResultAsync.fromPromise(
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(assistantMessages)
          .values({ userMessageId, content })
          .onConflictDoNothing({ target: assistantMessages.userMessageId })
          .returning({ id: assistantMessages.id })
        // 衝突したら何も書いていないので、そのまま抜けてよい（送信の状態も変えない）
        if (!row) return null
        await tx.insert(usageRecords).values({ userMessageId, ...usage })
        await tx
          .update(userMessages)
          .set({ status: 'completed' })
          .where(eq(userMessages.id, userMessageId))
        return row
      }),
      toRepositoryError,
    ).andThen((row) => (row ? okAsync(row) : errAsync({ type: 'duplicate_reply' as const }))),
})
