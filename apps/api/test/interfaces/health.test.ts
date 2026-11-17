import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '@/infrastructure/db/client'
import { createDatabaseHealthCheck } from '@/infrastructure/db/health-check'
import { createApp } from '@/interfaces/app'

describe('ヘルスチェック API', () => {
  const db = createDb({ connectionString: process.env.TEST_DATABASE_URL })

  afterAll(async () => {
    await db.$client.end()
  })

  it('呼んだとき DB 疎通を含めて ok を返す', async () => {
    const app = createApp({ checkDatabase: createDatabaseHealthCheck(db) })
    const client: AppClient = createORPCClient(
      new RPCLink({ url: 'http://localhost/api', fetch: async (request) => app.fetch(request) }),
    )

    const result = await client.health.check()

    expect(result).toEqual({ status: 'ok', database: 'ok' })
  })

  it('DB に接続できないとき 503 のエラーを返す', async () => {
    // 誰も待ち受けていないポートに向けて、接続失敗を再現する
    const unreachableDb = createDb({
      connectionString: 'postgres://app:app@localhost:1/app',
      connectionTimeoutMillis: 1_000,
    })
    const app = createApp({ checkDatabase: createDatabaseHealthCheck(unreachableDb) })
    const client: AppClient = createORPCClient(
      new RPCLink({ url: 'http://localhost/api', fetch: async (request) => app.fetch(request) }),
    )

    try {
      await expect(client.health.check()).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
      })
    } finally {
      await unreachableDb.$client.end()
    }
  })
})
