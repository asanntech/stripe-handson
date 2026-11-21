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

  it('失敗した client_message_id で再送したとき 同じ送信として再生成する', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const clientMessageId = crypto.randomUUID()
    const [failed] = await db
      .insert(userMessages)
      .values({
        conversationId: conversation.id,
        clientMessageId,
        content: 'こんにちは',
        status: 'failed',
      })
      .returning()
    if (!failed) throw new Error('準備: user_messages の INSERT が行を返しませんでした')
    const llm = new FakeLlmClient(() => ({ inputTokens: 5, outputTokens: 2 }))
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )

    const events = []
    for await (const event of await client.messages.send({
      conversationId: conversation.id,
      clientMessageId,
      content: 'こんにちは',
    }))
      events.push(event)

    expect(events.slice(0, -1)).toEqual([
      { type: 'delta', text: 'token1 ' },
      { type: 'delta', text: 'token2 ' },
    ])
    const sent = await db.select().from(userMessages)
    expect(sent).toEqual([expect.objectContaining({ id: failed.id, status: 'completed' })])
    const replies = await db.select().from(assistantMessages)
    expect(replies).toEqual([
      expect.objectContaining({ userMessageId: failed.id, content: 'token1 token2 ' }),
    ])
    expect(events.at(-1)).toEqual({ type: 'done', messageId: replies[0]?.id })
  })

  it('失敗した送信に本文の異なる再送が来たとき 保存済みの本文で再生成する（保存したプロンプトと応答を対応させる）', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const clientMessageId = crypto.randomUUID()
    await db.insert(userMessages).values({
      conversationId: conversation.id,
      clientMessageId,
      content: 'こんにちは',
      status: 'failed',
    })
    const prompts: string[] = []
    const llm = new FakeLlmClient(({ prompt }) => {
      prompts.push(prompt)
      return { inputTokens: 5, outputTokens: 1 }
    })
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )

    for await (const _ of await client.messages.send({
      conversationId: conversation.id,
      clientMessageId,
      content: '別の本文',
    })) {
      // 再生成を完了させる
    }

    expect(prompts).toEqual(['こんにちは'])
    expect(await db.select().from(userMessages)).toEqual([
      expect.objectContaining({ content: 'こんにちは', status: 'completed' }),
    ])
  })

  it('失敗した送信への再送が同時に来たとき（A の再生成中に B を送る順にバリアで固定）B は 409 になり LLM は 1 回しか呼ばれない', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const clientMessageId = crypto.randomUUID()
    await db.insert(userMessages).values({
      conversationId: conversation.id,
      clientMessageId,
      content: 'こんにちは',
      status: 'failed',
    })
    const aStreaming = createBarrier()
    const bFinished = createBarrier()
    let llmCalls = 0
    const fake = new FakeLlmClient(() => ({ inputTokens: 5, outputTokens: 3 }))
    // A の LLM 呼び出しを、B が終わるまで止めておく（その間 A の再送は「生成中」のまま）
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
    const input = { conversationId: conversation.id, clientMessageId, content: 'こんにちは' }

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
  })

  it('クライアントがストリームの途中で切断したとき 生成は最後まで続き 応答は「完了」として保存される', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    let llmCalls = 0
    // 切断した時点では生成が終わっていないよう、少し長い応答をゆっくり流す
    const llm = new FakeLlmClient(() => {
      llmCalls++
      return { inputTokens: 5, outputTokens: 20, chunkDelayMs: 10 }
    })
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
    for await (const _ of stream) {
      // 最初の delta を受け取ったところで切断する
      break
    }

    // 切断後もサーバー側で生成が続くので、完了するまで待つ
    await vi.waitFor(
      async () => {
        expect(await db.select().from(userMessages)).toEqual([
          expect.objectContaining({ status: 'completed' }),
        ])
      },
      { timeout: 5_000 },
    )
    const fullReply = Array.from({ length: 20 }, (_, i) => `token${i + 1} `).join('')
    expect(await db.select().from(assistantMessages)).toEqual([
      expect.objectContaining({ content: fullReply }),
    ])
    expect(llmCalls).toBe(1)
  })

  it('他人の会話で完了済みの client_message_id で送信したとき その応答は返らず 新しい送信として生成する', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    const [bob] = await db.insert(users).values({ name: 'bob' }).returning()
    if (!alice || !bob) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [aliceConversation] = await db
      .insert(conversations)
      .values({ userId: alice.id })
      .returning()
    const [bobConversation] = await db.insert(conversations).values({ userId: bob.id }).returning()
    if (!aliceConversation || !bobConversation) {
      throw new Error('準備: conversations の INSERT が行を返しませんでした')
    }
    let llmCalls = 0
    const llm = new FakeLlmClient(({ prompt }) => {
      llmCalls++
      // プロンプトごとに応答の長さを変え、誰の応答が返ったかを区別できるようにする
      return { inputTokens: 5, outputTokens: prompt === 'alice の相談' ? 3 : 1 }
    })
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const clientFor = (userId: string): AppClient =>
      createORPCClient(
        new RPCLink({
          url: 'http://localhost/api',
          headers: { 'x-user-id': userId },
          fetch: async (request) => app.fetch(request),
        }),
      )
    // Alice と Bob が（クライアントのバグなどで）同じ client_message_id を使う
    const sharedClientMessageId = crypto.randomUUID()
    for await (const _ of await clientFor(alice.id).messages.send({
      conversationId: aliceConversation.id,
      clientMessageId: sharedClientMessageId,
      content: 'alice の相談',
    })) {
      // Alice の送信を完了させる
    }

    const bobEvents = []
    for await (const event of await clientFor(bob.id).messages.send({
      conversationId: bobConversation.id,
      clientMessageId: sharedClientMessageId,
      content: 'bob の相談',
    }))
      bobEvents.push(event)

    expect(bobEvents.slice(0, -1)).toEqual([{ type: 'delta', text: 'token1 ' }])
    expect(llmCalls).toBe(2)
    expect(
      await db
        .select()
        .from(userMessages)
        .where(eq(userMessages.conversationId, bobConversation.id)),
    ).toEqual([expect.objectContaining({ content: 'bob の相談', status: 'completed' })])
  })

  it('他人の会話に送信したとき 404 を返し 送信は保存されず LLM も呼ばれない', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    const [bob] = await db.insert(users).values({ name: 'bob' }).returning()
    if (!alice || !bob) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [aliceConversation] = await db
      .insert(conversations)
      .values({ userId: alice.id })
      .returning()
    if (!aliceConversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    let llmCalls = 0
    const llm = new FakeLlmClient(() => {
      llmCalls++
      return { inputTokens: 5, outputTokens: 3 }
    })
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const bobClient: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': bob.id },
        fetch: async (request) => app.fetch(request),
      }),
    )

    const send = async () => {
      for await (const _ of await bobClient.messages.send({
        conversationId: aliceConversation.id,
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      })) {
        // 最初のイベントの前にエラーになるはず
      }
    }

    // 会話の存在を他人に知らせないよう、403 ではなく 404 にする
    await expect(send()).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 })
    expect(await db.select().from(userMessages)).toEqual([])
    expect(llmCalls).toBe(0)
  })

  it('存在しない会話に送信したとき 404 を返す', async () => {
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

    const send = async () => {
      for await (const _ of await client.messages.send({
        conversationId: crypto.randomUUID(),
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      })) {
        // 最初のイベントの前にエラーになるはず
      }
    }

    await expect(send()).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 })
  })

  it('本文が空のとき 400 を返し 送信は保存されず LLM も呼ばれない', async () => {
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

    const send = async () => {
      for await (const _ of await client.messages.send({
        conversationId: conversation.id,
        clientMessageId: crypto.randomUUID(),
        content: '',
      })) {
        // 最初のイベントの前にエラーになるはず
      }
    }

    await expect(send()).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 })
    expect(await db.select().from(userMessages)).toEqual([])
    expect(llmCalls).toBe(0)
  })

  it('client_message_id が UUID でないとき 400 を返す', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const app = createHonoApp(createTestRpcContext({ db }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )

    const send = async () => {
      for await (const _ of await client.messages.send({
        conversationId: conversation.id,
        clientMessageId: 'not-a-uuid',
        content: 'こんにちは',
      })) {
        // 最初のイベントの前にエラーになるはず
      }
    }

    await expect(send()).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 })
  })

  it('LLM がストリームの途中で切断したとき 届いたチャンクのあとに 502 のエラーを返し 送信は「失敗」として保存される', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const llm = new FakeLlmClient(() => ({
      inputTokens: 5,
      outputTokens: 5,
      disconnectAfterChunks: 2,
    }))
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )

    const events = []
    let error: unknown = null
    try {
      for await (const event of await client.messages.send({
        conversationId: conversation.id,
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      }))
        events.push(event)
    } catch (caught) {
      error = caught
    }

    expect(events).toEqual([
      { type: 'delta', text: 'token1 ' },
      { type: 'delta', text: 'token2 ' },
    ])
    expect(error).toMatchObject({ code: 'LLM_UNAVAILABLE', status: 502 })
    expect(await db.select().from(userMessages)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ])
    expect(await db.select().from(assistantMessages)).toEqual([])
  })

  it('ストリーミング中に 5xx のエラーが起きたとき procedure 名付きで原因をサーバー側のログに出す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    // 2 チャンク流したあとに LLM 側が切断する（ストリームを返したあとで 502 になる）
    const llm = new FakeLlmClient(() => ({
      inputTokens: 5,
      outputTokens: 5,
      disconnectAfterChunks: 2,
    }))
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )

    await expect(
      (async () => {
        for await (const _ of await client.messages.send({
          conversationId: conversation.id,
          clientMessageId: crypto.randomUUID(),
          content: 'こんにちは',
        })) {
          // チャンクを読み進める
        }
      })(),
    ).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' })

    expect(consoleError).toHaveBeenCalledWith(
      '[messages.send]',
      expect.objectContaining({
        code: 'LLM_UNAVAILABLE',
        cause: expect.objectContaining({ type: 'llm_unavailable' }),
      }),
    )
  })

  it('ストリーミング中に想定外の例外が起きたとき 500 を返し procedure 名付きでその例外をサーバー側のログに出す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const bug = new Error('想定外のバグ')
    // 1 チャンク流したあとに例外を投げる LLM（ポートの約束に反する＝バグ）
    const llm: LlmClient = {
      async *stream() {
        yield { type: 'delta', text: 'token1 ' }
        throw bug
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

    await expect(
      (async () => {
        for await (const _ of await client.messages.send({
          conversationId: conversation.id,
          clientMessageId: crypto.randomUUID(),
          content: 'こんにちは',
        })) {
          // チャンクを読み進める
        }
      })(),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', status: 500 })

    expect(consoleError).toHaveBeenCalledWith('[messages.send]', bug)
    // 想定外の例外で抜けても、送信は生成中のまま残らない
    expect(await db.select().from(userMessages)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ])
  })
})
