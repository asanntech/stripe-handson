import pg from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBarrier } from '../helpers/barrier.js'
import { truncateAllTables } from '../helpers/database.js'
import { waitUntilWaitingForLock } from '../helpers/lock.js'

describe('複数接続での行ロック', () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3 })

  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('2 接続で同じ行を FOR UPDATE したとき 後続の Tx は先行 Tx のコミットまで待たされる', async () => {
    const {
      rows: [user],
    } = await pool.query<{ id: string }>("INSERT INTO users (name) VALUES ('alice') RETURNING id")
    const clientA = await pool.connect()
    const clientB = await pool.connect()
    const aLocked = createBarrier()
    const events: string[] = []

    try {
      const txA = (async () => {
        await clientA.query('BEGIN')
        await clientA.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [user?.id])
        aLocked.open()
        // B がロック待ちに入ったのを確認してからコミットする
        await waitUntilWaitingForLock(pool, clientB)
        events.push('A: commit')
        await clientA.query('COMMIT')
      })()
      const txB = (async () => {
        await aLocked.wait()
        await clientB.query('BEGIN')
        await clientB.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [user?.id])
        events.push('B: locked')
        await clientB.query('COMMIT')
      })()
      await Promise.all([txA, txB])
    } finally {
      clientA.release()
      clientB.release()
    }

    expect(events).toEqual(['A: commit', 'B: locked'])
  })
})
