import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../../src/infrastructure/db/client.js'
import { users } from '../../src/infrastructure/db/schema.js'
import { truncateAllTables } from '../helpers/database.js'

describe('テスト間の TRUNCATE 分離', () => {
  const db = createDb({ connectionString: process.env.TEST_DATABASE_URL })

  beforeEach(async () => {
    await truncateAllTables(db.$client)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('前のテストで users に行を INSERT する', async () => {
    await db.insert(users).values({ name: 'alice' })

    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('次のテスト開始時には users が空になっている', async () => {
    expect(await db.select().from(users)).toEqual([])
  })
})
