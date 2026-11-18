import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { users } from '@/infrastructure/db/schema'
import { createBarrier } from '../helpers/barrier'
import { truncateAllTables } from '../helpers/database'
import { waitUntilWaitingForLock } from '../helpers/lock'

describe('複数接続での行ロック', () => {
  // Tx A・Tx B・ロック待ちの観測用で 3 接続使う
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL'), max: 3 })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('2 接続で同じ行を FOR UPDATE したとき 後続の Tx は先行 Tx のコミットまで待たされる', async () => {
    const [user] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!user) throw new Error('準備: users の INSERT が行を返しませんでした')
    const userId = user.id
    const aLocked = createBarrier()
    const bPid = Promise.withResolvers<number>()
    const events: string[] = []

    const txA = db.transaction(async (tx) => {
      await tx.select().from(users).where(eq(users.id, userId)).for('update')
      aLocked.open()
      // B がロック待ちに入ったのを確認してからコミットする（コールバックを抜けると COMMIT）
      await waitUntilWaitingForLock(db, await bPid.promise)
      events.push('A: commit')
    })
    const txB = (async () => {
      await aLocked.wait()
      await db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        const pid = rows[0]?.pid
        if (pid === undefined) {
          // A が pid を待ち続けて固まらないよう、A 側にも失敗を伝える
          const error = new Error('準備: Tx B の pg_backend_pid() が取得できませんでした')
          bPid.reject(error)
          throw error
        }
        bPid.resolve(pid)
        await tx.select().from(users).where(eq(users.id, userId)).for('update')
        events.push('B: locked')
      })
    })()
    await Promise.all([txA, txB])

    expect(events).toEqual(['A: commit', 'B: locked'])
  })
})
