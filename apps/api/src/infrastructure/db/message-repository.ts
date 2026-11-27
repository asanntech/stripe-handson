import { and, eq } from 'drizzle-orm'
import { err, ok } from '@/domain/result'
import type { MessageRepository } from '@/usecases/ports/message-repository'
import type { DbExecutor } from './client'
import { assistantMessages, usageRecords, userMessages } from './schema'

export const createMessageRepository = (db: DbExecutor): MessageRepository => ({
  createUserMessage: async (message) => {
    const [row] = await db
      .insert(userMessages)
      .values({ ...message, status: 'generating' })
      // 衝突したら何もせず 0 行を返す（例外にしないので Tx を壊さない）
      .onConflictDoNothing({
        target: [userMessages.conversationId, userMessages.clientMessageId],
      })
      .returning({ id: userMessages.id })
    return row ? ok(row) : err({ type: 'duplicate_client_message' })
  },

  findByClientMessageId: async ({ conversationId, clientMessageId }) => {
    const [row] = await db
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
      )
    if (!row) return null
    const { id, status, content, replyId, replyContent } = row
    const reply =
      replyId !== null && replyContent !== null ? { id: replyId, content: replyContent } : null
    return { id, status, content, reply }
  },

  // WHERE に status = 'failed' を含めるので、同時に実行されても先に行ロックを取った 1 つだけが更新できる
  // （後続は先行のコミットを待ってから条件を再評価し、0 行になる）
  claimFailedForRetry: async (userMessageId) => {
    const rows = await db
      .update(userMessages)
      .set({ status: 'generating' })
      .where(and(eq(userMessages.id, userMessageId), eq(userMessages.status, 'failed')))
      .returning({ id: userMessages.id })
    return rows.length === 1
  },

  markFailed: async (userMessageId) => {
    await db
      .update(userMessages)
      .set({ status: 'failed' })
      .where(and(eq(userMessages.id, userMessageId), eq(userMessages.status, 'generating')))
  },

  // 応答・利用記録の INSERT と送信の状態更新は同じ Tx で行う（一部だけ反映されないように）
  complete: async ({ userMessageId, content, usage }) => {
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(assistantMessages)
        .values({ userMessageId, content })
        .onConflictDoNothing({ target: assistantMessages.userMessageId })
        .returning({ id: assistantMessages.id })
      // 衝突したら何も書いていないので、そのまま抜けてよい（送信の状態も変えない）
      if (!inserted) return null
      await tx.insert(usageRecords).values({ userMessageId, ...usage })
      await tx
        .update(userMessages)
        .set({ status: 'completed' })
        .where(eq(userMessages.id, userMessageId))
      return inserted
    })
    return row ? ok(row) : err({ type: 'duplicate_reply' })
  },
})
