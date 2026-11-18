import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { conversations, users } from '@/infrastructure/db/schema'
import { createHonoApp } from '@/interfaces/hono/app'
import { truncateAllTables } from '../helpers/database'
import { createTestRpcContext } from '../helpers/rpc-context'

describe('会話 API', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('X-User-Id のユーザーが会話を作成したとき 会話 ID を返す', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const app = createHonoApp(createTestRpcContext({ db }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )

    const { conversationId } = await client.conversations.create()

    const saved = await db.select().from(conversations).where(eq(conversations.id, conversationId))
    expect(saved).toEqual([expect.objectContaining({ userId: alice.id })])
  })
})
