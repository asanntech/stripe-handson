import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../../src/infrastructure/db/client.js'
import { users } from '../../src/infrastructure/db/schema.js'

describe('マイグレーション', () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
  const db = createDb(pool)

  afterAll(async () => {
    await pool.end()
  })

  it('適用後のテスト DB に users を INSERT したとき SELECT で読み戻せる', async () => {
    const [inserted] = await db.insert(users).values({ name: 'alice' }).returning()

    const rows = await db.select().from(users)

    expect(rows).toContainEqual(inserted)
    expect(inserted?.name).toBe('alice')
  })
})
