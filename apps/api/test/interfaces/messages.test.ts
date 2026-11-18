import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { assistantMessages, conversations, userMessages, users } from '@/infrastructure/db/schema'
import { FakeLlmClient } from '@/infrastructure/llm/fake-llm-client'
import { createHonoApp } from '@/interfaces/hono/app'
import type { LlmClient } from '@/usecases/ports/llm-client'
import { createBarrier } from '../helpers/barrier'
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

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('生成中の client_message_id で再送したとき（A のストリーム中に B を送る順にバリアで固定）B は 409 になり LLM は 1 回しか呼ばれない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const aStreaming = createBarrier()
    const bFinished = createBarrier()
    let llmCalls = 0
    const fake = new FakeLlmClient(() => ({ inputTokens: 5, outputTokens: 3 }))
    // A の LLM 呼び出しを、B が終わるまで止めておく（その間 A の送信は「生成中」のまま）
    const llm: LlmClient = {
      async *stream(request) {
        llmCalls++
        aStreaming.open()
        await bFinished.wait()
        yield* fake.stream(request)
      },
    }
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

    const sendA = (async () => {
      const events = []
      for await (const event of await client.messages.send(input)) events.push(event)
      return events
    })()
    const sendB = (async () => {
      await aStreaming.wait()
      try {
        for await (const _ of await client.messages.send(input)) {
          // B は最初のイベントの前にエラーになるはず
        }
        return null
      } catch (error) {
        return error
      } finally {
        bFinished.open()
      }
    })()
    const [eventsA, errorB] = await Promise.all([sendA, sendB])

    expect(errorB).toMatchObject({ code: 'MESSAGE_IN_PROGRESS', status: 409 })
    expect(eventsA.at(-1)).toEqual({ type: 'done', messageId: expect.any(String) })
    expect(llmCalls).toBe(1)
    // 409 はクライアント起因なのでサーバー側のログに出さない
    expect(consoleError).not.toHaveBeenCalled()
  })
})
