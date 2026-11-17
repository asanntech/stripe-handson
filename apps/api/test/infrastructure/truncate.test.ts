import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '@/infrastructure/db/client'
import { users } from '@/infrastructure/db/schema'
import { truncateAllTables } from '../helpers/database'

describe('テスト間の TRUNCATE 分離', () => {
  const db = createDb({ connectionString: process.env.TEST_DATABASE_URL })

  beforeEach(async () => {
    await truncateAllTables(db)
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
