import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '@/infrastructure/db/client'
import { users } from '@/infrastructure/db/schema'
import { createBarrier } from '../helpers/barrier'
import { truncateAllTables } from '../helpers/database'
import { waitUntilWaitingForLock } from '../helpers/lock'

describe('複数接続での行ロック', () => {
  // Tx A・Tx B・ロック待ちの観測用で 3 接続使う
  const db = createDb({ connectionString: process.env.TEST_DATABASE_URL, max: 3 })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('2 接続で同じ行を FOR UPDATE したとき 後続の Tx は先行 Tx のコミットまで待たされる', async () => {
    const [user] = await db.insert(users).values({ name: 'alice' }).returning()
    const userId = user?.id ?? ''
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
        bPid.resolve(rows[0]?.pid ?? 0)
        await tx.select().from(users).where(eq(users.id, userId)).for('update')
        events.push('B: locked')
      })
    })()
    await Promise.all([txA, txB])

    expect(events).toEqual(['A: commit', 'B: locked'])
  })
})
