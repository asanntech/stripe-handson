import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { getPgErrorCode, PG_ERROR_CODE } from '@/infrastructure/db/pg-error'
import { users } from '@/infrastructure/db/schema'
import { createBarrier } from '../helpers/barrier'
import { truncateAllTables } from '../helpers/database'

describe('ロックタイムアウト', () => {
  // Tx A・Tx B で 2 接続使う
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL'), max: 2 })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('2 接続で同じ行をロックし短い lock_timeout を設定したとき 後続の Tx がロックタイムアウトエラーになる', async () => {
    const [user] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!user) throw new Error('準備: users の INSERT が行を返しませんでした')
    const userId = user.id
    const aLocked = createBarrier()
    const bFinished = createBarrier()

    const txA = db.transaction(async (tx) => {
      await tx.select().from(users).where(eq(users.id, userId)).for('update')
      aLocked.open()
      // B がタイムアウトで終わるまでロックを持ち続ける
      await bFinished.wait()
    })
    const txB = (async () => {
      await aLocked.wait()
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`)
          await tx.select().from(users).where(eq(users.id, userId)).for('update')
        })
        return undefined
      } catch (error) {
        return error
      } finally {
        bFinished.open()
      }
    })()
    const [, errorB] = await Promise.all([txA, txB])

    expect(getPgErrorCode(errorB)).toBe(PG_ERROR_CODE.lockNotAvailable)
  })
})
