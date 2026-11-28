import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { createBarrier } from '@test/helpers/barrier'
import { truncateAllTables } from '@test/helpers/database'
import { createTestRpcContext } from '@test/helpers/rpc-context'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { conversations, modelPrices, models, userMessages, users } from '@/infrastructure/db/schema'
import { FakeLlmClient } from '@/infrastructure/llm/fake-llm-client'
import { createHonoApp } from '@/interfaces/hono/app'
import type { LlmClient } from '@/usecases/ports/llm-client'
import { MODEL } from '@/usecases/send-message'

// API 経由で確かめるのは、ストリームの形（切断の伝わり方を含む）・入力の検証・ユースケースのエラー → contract のエラーの変換・5xx のログだけ。
// 業務の流れ（再送・競合・保存される状態など）は usecases/send-message.test.ts で検証する（.claude/rules/testing.md）
describe('メッセージ API', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  const createUserWithConversation = async () => {
    const [user] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!user) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: user.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    return { userId: user.id, conversationId: conversation.id }
  }

  const createClient = (userId: string, llm?: LlmClient): AppClient => {
    const app = createHonoApp(createTestRpcContext(llm === undefined ? { db } : { db, llm }))
    return createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': userId },
        fetch: async (request) => app.fetch(request),
      }),
    )
  }

  // ストリームを最後まで読む（エラーで終わるときは、届いたイベントとエラーの両方を返す）
  const readAll = async (stream: AsyncIterable<unknown>) => {
    const events: unknown[] = []
    try {
      for await (const event of stream) events.push(event)
      return { events, error: null }
    } catch (error) {
      return { events, error }
    }
  }

  beforeEach(async () => {
    await truncateAllTables(db)
    // 送信の前提として単価を登録しておく
    const [model] = await db.insert(models).values({ name: MODEL }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    await db.insert(modelPrices).values({
      modelId: model.id,
      inputPerMillionTokens: 3_000,
      outputPerMillionTokens: 15_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    })
  })

  afterAll(async () => {
    await db.$client.end()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('自分の会話にメッセージを送信したとき LLM の応答をチャンクごとにストリームし 最後に完了イベントを返す', async () => {
    const alice = await createUserWithConversation()
    const llm = new FakeLlmClient(() => ({ inputTokens: 5, outputTokens: 3 }))
    const client = createClient(alice.userId, llm)

    const { events, error } = await readAll(
      await client.messages.send({
        conversationId: alice.conversationId,
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      }),
    )

    expect(error).toBeNull()
    expect(events).toEqual([
      { type: 'delta', text: 'token1 ' },
      { type: 'delta', text: 'token2 ' },
      { type: 'delta', text: 'token3 ' },
      { type: 'done', messageId: expect.any(String) },
    ])
  })

  it('クライアントがストリームの途中で切断したとき 生成は最後まで続き 送信は「完了」として保存される', async () => {
    const alice = await createUserWithConversation()
    const disconnected = createBarrier()
    // 最初のチャンクを流したら、クライアントが切断するまで残りを流さない（切断した時点で必ず生成中にする）
    const llm: LlmClient = {
      async *stream() {
        yield { type: 'delta', text: 'token1 ' }
        await disconnected.wait()
        yield { type: 'delta', text: 'token2 ' }
        yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } }
      },
    }
    const client = createClient(alice.userId, llm)

    const stream = await client.messages.send({
      conversationId: alice.conversationId,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    })
    for await (const _ of stream) {
      // 最初の delta を受け取ったところで切断する
      break
    }
    // 切断が oRPC / Hono / handler を通ってユースケースまで伝わっても、生成は切り離されて続く
    // （再送の扱いなど業務の分岐は usecases/send-message.test.ts で検証する）
    disconnected.open()

    await vi.waitFor(
      async () => {
        expect(await db.select().from(userMessages)).toEqual([
          expect.objectContaining({ status: 'completed' }),
        ])
      },
      { timeout: 5_000 },
    )
  })

  it('存在しない会話に送信したとき 404 を返す', async () => {
    const alice = await createUserWithConversation()
    const client = createClient(alice.userId)

    const { error } = await readAll(
      await client.messages.send({
        conversationId: crypto.randomUUID(),
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      }),
    )

    // 他人の会話も同じ 404 になる（会話の存在を他人に知らせないため。区別しないことはユースケースのテストで検証する）
    expect(error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 })
  })

  it('同じ client_message_id の送信が生成中のとき 409 を返し サーバー側のログには出さない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const alice = await createUserWithConversation()
    const clientMessageId = crypto.randomUUID()
    await db.insert(userMessages).values({
      conversationId: alice.conversationId,
      clientMessageId,
      content: 'こんにちは',
      status: 'generating',
    })
    const client = createClient(alice.userId)

    const { error } = await readAll(
      await client.messages.send({
        conversationId: alice.conversationId,
        clientMessageId,
        content: 'こんにちは',
      }),
    )

    expect(error).toMatchObject({ code: 'MESSAGE_IN_PROGRESS', status: 409 })
    // 409 はクライアント起因なのでサーバー側のログに出さない
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('本文が空のとき 400 を返し 送信は保存されず LLM も呼ばれない', async () => {
    const alice = await createUserWithConversation()
    let llmCalls = 0
    const llm = new FakeLlmClient(() => {
      llmCalls++
      return { inputTokens: 5, outputTokens: 3 }
    })
    const client = createClient(alice.userId, llm)

    const send = async () =>
      readAll(
        await client.messages.send({
          conversationId: alice.conversationId,
          clientMessageId: crypto.randomUUID(),
          content: '',
        }),
      )

    await expect(send()).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 })
    expect(await db.select().from(userMessages)).toEqual([])
    expect(llmCalls).toBe(0)
  })

  it('client_message_id が UUID でないとき 400 を返す', async () => {
    const alice = await createUserWithConversation()
    const client = createClient(alice.userId)

    const send = async () =>
      readAll(
        await client.messages.send({
          conversationId: alice.conversationId,
          clientMessageId: 'not-a-uuid',
          content: 'こんにちは',
        }),
      )

    await expect(send()).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 })
  })

  it('LLM がストリームの途中で切断したとき 届いたチャンクのあとに 502 を返し procedure 名付きで原因をサーバー側のログに出す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const alice = await createUserWithConversation()
    // 2 チャンク流したあとに LLM 側が切断する（ストリームを返したあとで 502 になる）
    const llm = new FakeLlmClient(() => ({
      inputTokens: 5,
      outputTokens: 5,
      disconnectAfterChunks: 2,
    }))
    const client = createClient(alice.userId, llm)

    const { events, error } = await readAll(
      await client.messages.send({
        conversationId: alice.conversationId,
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      }),
    )

    expect(events).toEqual([
      { type: 'delta', text: 'token1 ' },
      { type: 'delta', text: 'token2 ' },
    ])
    expect(error).toMatchObject({ code: 'LLM_UNAVAILABLE', status: 502 })
    expect(consoleError).toHaveBeenCalledWith(
      '[messages.send]',
      expect.objectContaining({
        code: 'LLM_UNAVAILABLE',
        cause: expect.objectContaining({ type: 'llm_unavailable' }),
      }),
    )
  })

  it('モデルの単価が未登録のとき 500 を返し procedure 名付きで原因をサーバー側のログに出す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // model_prices は追記専用（DELETE 不可）なので、beforeEach で登録した単価ごと TRUNCATE し直す
    await truncateAllTables(db)
    const alice = await createUserWithConversation()
    const client = createClient(alice.userId)

    const { error } = await readAll(
      await client.messages.send({
        conversationId: alice.conversationId,
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      }),
    )

    expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', status: 500 })
    expect(consoleError).toHaveBeenCalledWith(
      '[messages.send]',
      expect.objectContaining({
        status: 500,
        cause: { type: 'model_price_not_found', model: MODEL },
      }),
    )
  })

  it('ストリーミング中に想定外の例外が起きたとき 500 を返し procedure 名付きでその例外をサーバー側のログに出す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const alice = await createUserWithConversation()
    const bug = new Error('想定外のバグ')
    // 1 チャンク流したあとに例外を投げる LLM（ポートの約束に反する＝バグ）
    const llm: LlmClient = {
      async *stream() {
        yield { type: 'delta', text: 'token1 ' }
        throw bug
      },
    }
    const client = createClient(alice.userId, llm)

    const { error } = await readAll(
      await client.messages.send({
        conversationId: alice.conversationId,
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      }),
    )

    expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', status: 500 })
    expect(consoleError).toHaveBeenCalledWith('[messages.send]', bug)
  })
})
