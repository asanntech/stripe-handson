import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { assistantMessages, conversations, userMessages, users } from '@/infrastructure/db/schema'
import { FakeLlmClient } from '@/infrastructure/llm/fake-llm-client'
import { createHonoApp } from '@/interfaces/hono/app'
import { truncateAllTables } from '../helpers/database'
import { createTestRpcContext } from '../helpers/rpc-context'

describe('メッセージ API', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('自分の会話にメッセージを送信したとき LLM の応答をチャンクごとにストリームし 最後に完了イベントを返す', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const llm = new FakeLlmClient(() => ({ inputTokens: 5, outputTokens: 3 }))
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )

    const stream = await client.messages.send({
      conversationId: conversation.id,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    })
    const events = []
    for await (const event of stream) events.push(event)

    expect(events).toEqual([
      { type: 'delta', text: 'token1 ' },
      { type: 'delta', text: 'token2 ' },
      { type: 'delta', text: 'token3 ' },
      { type: 'done', messageId: expect.any(String) },
    ])
  })

  it('応答が完了したとき 送信（プロンプト・完了）と応答全文が保存され 完了イベントは応答の ID を返す', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const llm = new FakeLlmClient(() => ({ inputTokens: 5, outputTokens: 3 }))
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )
    const clientMessageId = crypto.randomUUID()

    const stream = await client.messages.send({
      conversationId: conversation.id,
      clientMessageId,
      content: 'こんにちは',
    })
    const events = []
    for await (const event of stream) events.push(event)

    const sent = await db
      .select()
      .from(userMessages)
      .where(eq(userMessages.conversationId, conversation.id))
    expect(sent).toEqual([
      expect.objectContaining({ content: 'こんにちは', clientMessageId, status: 'completed' }),
    ])
    const replies = await db
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.userMessageId, sent[0]?.id ?? ''))
    expect(replies).toEqual([expect.objectContaining({ content: 'token1 token2 token3 ' })])
    expect(events.at(-1)).toEqual({ type: 'done', messageId: replies[0]?.id })
  })

  it('完了済みの client_message_id で再送したとき LLM を呼ばずに保存済みの応答を返す', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    let llmCalls = 0
    const llm = new FakeLlmClient(() => {
      llmCalls++
      return { inputTokens: 5, outputTokens: 3 }
    })
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )
    const input = {
      conversationId: conversation.id,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    }
    const firstEvents = []
    for await (const event of await client.messages.send(input)) firstEvents.push(event)

    const retryEvents = []
    for await (const event of await client.messages.send(input)) retryEvents.push(event)

    expect(retryEvents).toEqual([
      { type: 'delta', text: 'token1 token2 token3 ' },
      firstEvents.at(-1),
    ])
    expect(llmCalls).toBe(1)
    expect(await db.select().from(userMessages)).toHaveLength(1)
  })
})
