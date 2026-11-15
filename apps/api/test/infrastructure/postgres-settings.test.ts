import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('テスト用 PostgreSQL の設定', () => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })

  beforeAll(async () => {
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('log_lock_waits が on で auto_explain がロード済みである', async () => {
    const lockWaits = await client.query<{ log_lock_waits: string }>('SHOW log_lock_waits')
    const preload = await client.query<{ shared_preload_libraries: string }>(
      'SHOW shared_preload_libraries',
    )

    expect(lockWaits.rows[0]?.log_lock_waits).toBe('on')
    expect(preload.rows[0]?.shared_preload_libraries).toContain('auto_explain')
  })
})
