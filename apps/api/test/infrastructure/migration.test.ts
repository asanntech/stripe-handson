import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../../src/infrastructure/db/client.js'
import { users } from '../../src/infrastructure/db/schema.js'
import { truncateAllTables } from '../helpers/database.js'

describe('マイグレーション', () => {
  const db = createDb({ connectionString: process.env.TEST_DATABASE_URL })

  beforeEach(async () => {
    await truncateAllTables(db.$client)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('適用後のテスト DB に users を INSERT したとき SELECT で読み戻せる', async () => {
    const [inserted] = await db.insert(users).values({ name: 'alice' }).returning()

    const rows = await db.select().from(users)

    expect(rows).toEqual([inserted])
    expect(inserted?.name).toBe('alice')
  })
})
