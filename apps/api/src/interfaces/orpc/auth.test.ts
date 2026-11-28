import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { truncateAllTables } from '@test/helpers/database'
import { createTestRpcContext } from '@test/helpers/rpc-context'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { conversations } from '@/infrastructure/db/schema'
import { createHonoApp } from '@/interfaces/hono/app'

describe('X-User-Id による認証', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('X-User-Id がないとき 401 を返し サーバー側のログには出さない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createHonoApp(createTestRpcContext({ db }))
    const client: AppClient = createORPCClient(
      new RPCLink({ url: 'http://localhost/api', fetch: async (request) => app.fetch(request) }),
    )

    await expect(client.conversations.create()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    })
    expect(await db.select().from(conversations)).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('X-User-Id が存在しないユーザーのとき 401 を返す', async () => {
    const app = createHonoApp(createTestRpcContext({ db }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': crypto.randomUUID() },
        fetch: async (request) => app.fetch(request),
      }),
    )

    await expect(client.conversations.create()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    })
  })

  it('X-User-Id が UUID でないとき 401 を返す', async () => {
    const app = createHonoApp(createTestRpcContext({ db }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': 'not-a-uuid' },
        fetch: async (request) => app.fetch(request),
      }),
    )

    await expect(client.conversations.create()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    })
  })

  it('X-User-Id がないままメッセージを送信したとき 401 を返す', async () => {
    const app = createHonoApp(createTestRpcContext({ db }))
    const client: AppClient = createORPCClient(
      new RPCLink({ url: 'http://localhost/api', fetch: async (request) => app.fetch(request) }),
    )

    const send = async () => {
      for await (const _ of await client.messages.send({
        conversationId: crypto.randomUUID(),
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      })) {
        // 最初のイベントの前にエラーになるはず
      }
    }

    await expect(send()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 })
  })
})
