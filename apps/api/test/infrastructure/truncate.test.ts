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

  it('接続先の DB 名が _test で終わらないとき 何も消さずにエラーにする', async () => {
    // 誤って開発用 DB に向けた状況を、テーブルの無い保守用 DB（postgres）で再現する
    const url = new URL(process.env.TEST_DATABASE_URL ?? '')
    url.pathname = '/postgres'
    const nonTestDb = createDb({ connectionString: url.toString() })

    try {
      await expect(truncateAllTables(nonTestDb)).rejects.toThrow('_test')
    } finally {
      await nonTestDb.$client.end()
    }
  })
})
