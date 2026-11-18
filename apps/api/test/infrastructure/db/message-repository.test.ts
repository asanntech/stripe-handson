import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { createMessageRepository } from '@/infrastructure/db/message-repository'
import { conversations, userMessages, users } from '@/infrastructure/db/schema'
import { createBarrier } from '../../helpers/barrier'
import { truncateAllTables } from '../../helpers/database'
import { waitUntilWaitingForLock } from '../../helpers/lock'

describe('MessageRepository: 受付 INSERT の競合', () => {
  // Tx A・Tx B・ロック待ちの観測用で 3 接続使う
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL'), max: 3 })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('バリアで A の受付 INSERT（未コミット）→ B の受付 INSERT の順に固定したとき B は A のコミットまで待たされ 重複として扱われる', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const message = {
      conversationId: conversation.id,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    }
    const aInserted = createBarrier()
    const bPid = Promise.withResolvers<number>()
    const events: string[] = []

    const txA = db.transaction(async (tx) => {
      const result = await createMessageRepository(tx).createUserMessage(message)
      if (result.isErr()) throw new Error('準備: A の受付が失敗しました')
      aInserted.open()
      // B が A の INSERT の結末待ちに入ったのを確認してからコミットする（コールバックを抜けると COMMIT）
      await waitUntilWaitingForLock(db, await bPid.promise)
      events.push('A: commit')
    })
    const txB = (async () => {
      await aInserted.wait()
      return db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        const pid = rows[0]?.pid
        if (pid === undefined) {
          const error = new Error('準備: Tx B の pg_backend_pid() が取得できませんでした')
          bPid.reject(error)
          throw error
        }
        bPid.resolve(pid)
        const result = await createMessageRepository(tx).createUserMessage(message)
        events.push('B: inserted')
        return result
      })
    })()
    const [, resultB] = await Promise.all([txA, txB])

    expect(events).toEqual(['A: commit', 'B: inserted'])
    expect(resultB._unsafeUnwrapErr()).toEqual({ type: 'duplicate_client_message' })
    expect(await db.select().from(userMessages)).toHaveLength(1)
  })

  it('バリアで A の受付 INSERT（未コミット）→ B の受付 INSERT の順に固定し A がロールバックしたとき B の送信が受け付けられる', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const message = {
      conversationId: conversation.id,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    }
    const aInserted = createBarrier()
    const bPid = Promise.withResolvers<number>()
    const rollbackA = new Error('A をロールバックさせる')

    const txA = db
      .transaction(async (tx) => {
        const result = await createMessageRepository(tx).createUserMessage(message)
        if (result.isErr()) throw new Error('準備: A の受付が失敗しました')
        aInserted.open()
        await waitUntilWaitingForLock(db, await bPid.promise)
        // コールバックが throw すると ROLLBACK になる
        throw rollbackA
      })
      .catch((error: unknown) => {
        if (error !== rollbackA) throw error
      })
    const txB = (async () => {
      await aInserted.wait()
      return db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        const pid = rows[0]?.pid
        if (pid === undefined) {
          const error = new Error('準備: Tx B の pg_backend_pid() が取得できませんでした')
          bPid.reject(error)
          throw error
        }
        bPid.resolve(pid)
        return createMessageRepository(tx).createUserMessage(message)
      })
    })()
    const [, resultB] = await Promise.all([txA, txB])

    const saved = await db.select().from(userMessages)
    expect(saved).toEqual([expect.objectContaining({ id: resultB._unsafeUnwrap().id })])
  })
})
