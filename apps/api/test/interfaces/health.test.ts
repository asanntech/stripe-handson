import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../../src/infrastructure/db/client.js'
import { createDatabaseHealthCheck } from '../../src/infrastructure/db/health-check.js'
import { createApp } from '../../src/interfaces/app.js'

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
})
