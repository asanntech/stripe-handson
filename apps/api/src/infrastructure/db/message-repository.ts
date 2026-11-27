import { and, eq } from 'drizzle-orm'
import { err, ok } from '@/domain/result'
import type { MessageRepository } from '@/usecases/ports/message-repository'
import type { DbExecutor } from './client'
import { assistantMessages, usageRecords, userMessages } from './schema'
import { tryQuery } from './try-query'

export const createMessageRepository = (db: DbExecutor): MessageRepository => ({
  createUserMessage: async (message) => {
    const rows = await tryQuery(
      db
        .insert(userMessages)
        .values({ ...message, status: 'generating' })
        // 衝突したら何もせず 0 行を返す（例外にしないので Tx を壊さない）
        .onConflictDoNothing({
          target: [userMessages.conversationId, userMessages.clientMessageId],
        })
        .returning({ id: userMessages.id }),
    )
    if (!rows.ok) return rows
    const [row] = rows.value
    return row ? ok(row) : err({ type: 'duplicate_client_message' })
  },

  findByClientMessageId: async ({ conversationId, clientMessageId }) => {
    const rows = await tryQuery(
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
    )
    if (!rows.ok) return rows
    const [row] = rows.value
    if (!row) return ok(null)
    const { id, status, content, replyId, replyContent } = row
    const reply =
      replyId !== null && replyContent !== null ? { id: replyId, content: replyContent } : null
    return ok({ id, status, content, reply })
  },

  // WHERE に status = 'failed' を含めるので、同時に実行されても先に行ロックを取った 1 つだけが更新できる
  // （後続は先行のコミットを待ってから条件を再評価し、0 行になる）
  claimFailedForRetry: async (userMessageId) => {
    const rows = await tryQuery(
      db
        .update(userMessages)
        .set({ status: 'generating' })
        .where(and(eq(userMessages.id, userMessageId), eq(userMessages.status, 'failed')))
        .returning({ id: userMessages.id }),
    )
    if (!rows.ok) return rows
    return ok(rows.value.length === 1)
  },

  markFailed: async (userMessageId) => {
    const updated = await tryQuery(
      db
        .update(userMessages)
        .set({ status: 'failed' })
        .where(and(eq(userMessages.id, userMessageId), eq(userMessages.status, 'generating'))),
    )
    if (!updated.ok) return updated
    return ok(undefined)
  },

  // 応答・利用記録の INSERT と送信の状態更新は同じ Tx で行う（一部だけ反映されないように）
  complete: async ({ userMessageId, content, usage }) => {
    const saved = await tryQuery(
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
    )
    if (!saved.ok) return saved
    return saved.value ? ok(saved.value) : err({ type: 'duplicate_reply' })
  },
})
