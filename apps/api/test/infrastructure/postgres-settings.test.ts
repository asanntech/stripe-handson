import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../../src/infrastructure/db/client.js'

describe('テスト用 PostgreSQL の設定', () => {
  const db = createDb({ connectionString: process.env.TEST_DATABASE_URL })

  afterAll(async () => {
    await db.$client.end()
  })

  it('log_lock_waits が on で auto_explain がロード済みである', async () => {
    const lockWaits = await db.execute<{ log_lock_waits: string }>(sql`SHOW log_lock_waits`)
    const preload = await db.execute<{ shared_preload_libraries: string }>(
      sql`SHOW shared_preload_libraries`,
    )

    expect(lockWaits.rows[0]?.log_lock_waits).toBe('on')
    expect(preload.rows[0]?.shared_preload_libraries).toContain('auto_explain')
  })
})
