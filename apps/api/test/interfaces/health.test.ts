import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { createDatabaseHealthCheck } from '@/infrastructure/db/health-check'
import { createApp } from '@/interfaces/app'

describe('ヘルスチェック API', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  afterAll(async () => {
    await db.$client.end()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('DB に接続できないとき 503 の原因をサーバー側のログに出す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unreachableDb = createDb({
      connectionString: 'postgres://app:app@localhost:1/app',
      connectionTimeoutMillis: 1_000,
    })
    const app = createApp({ checkDatabase: createDatabaseHealthCheck(unreachableDb) })
    const client: AppClient = createORPCClient(
      new RPCLink({ url: 'http://localhost/api', fetch: async (request) => app.fetch(request) }),
    )

    try {
      await client.health.check().catch(() => {})
    } finally {
      await unreachableDb.$client.end()
    }

    // ログは onError インターセプター 1 か所で、原因（cause）付きの ORPCError として出る
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SERVICE_UNAVAILABLE',
        cause: expect.objectContaining({ type: 'database_unavailable', cause: expect.anything() }),
      }),
    )
  })

  it('ハンドラーで想定外の例外が起きたとき 500 を返し その例外をサーバー側のログに出す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bug = new Error('想定外のバグ')
    const app = createApp({
      checkDatabase: () => {
        throw bug
      },
    })
    const client: AppClient = createORPCClient(
      new RPCLink({ url: 'http://localhost/api', fetch: async (request) => app.fetch(request) }),
    )

    await expect(client.health.check()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      status: 500,
    })
    expect(consoleError).toHaveBeenCalledWith(bug)
  })

  it('リクエストが壊れていて 4xx を返すとき サーバー側のログには出さない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createApp({ checkDatabase: createDatabaseHealthCheck(db) })

    const response = await app.fetch(
      new Request('http://localhost/api/health/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    )

    expect(response.status).toBe(400)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
