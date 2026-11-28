import { createBarrier } from '@test/helpers/barrier'
import { truncateAllTables } from '@test/helpers/database'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { createConversationRepository } from '@/infrastructure/db/conversation-repository'
import { createMessageRepository } from '@/infrastructure/db/message-repository'
import { createModelPriceRepository } from '@/infrastructure/db/model-price-repository'
import {
  assistantMessages,
  conversations,
  modelPrices,
  models,
  userMessages,
  users,
} from '@/infrastructure/db/schema'
import { FakeLlmClient } from '@/infrastructure/llm/fake-llm-client'
import type { LlmClient } from '@/usecases/ports/llm-client'
import { MODEL, type SendMessageEvent, type SendMessageInput, sendMessage } from './send-message'

describe('メッセージの送信（sendMessage）', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  // 依存は本物のリポジトリ（実 PostgreSQL）を渡し、LLM だけ Fake にする（.claude/rules/testing.md）
  const send = (llm: LlmClient, input: SendMessageInput) =>
    sendMessage(
      {
        conversations: createConversationRepository(db),
        messages: createMessageRepository(db),
        modelPrices: createModelPriceRepository(db),
        llm,
      },
      input,
    )

  const collect = async (events: AsyncIterable<SendMessageEvent>) => {
    const collected: SendMessageEvent[] = []
    for await (const event of events) collected.push(event)
    return collected
  }

  const createUserWithConversation = async (name: string) => {
    const [user] = await db.insert(users).values({ name }).returning()
    if (!user) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: user.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    return { userId: user.id, conversationId: conversation.id }
  }

  beforeEach(async () => {
    await truncateAllTables(db)
    // 送信の前提として単価を登録しておく（単価・利用履歴の振る舞いは send-message-usage.test.ts で検証する）
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

  it('応答が完了したとき 送信（プロンプト・完了）と応答全文が保存され 完了イベントは応答の ID を返す', async () => {
    const alice = await createUserWithConversation('alice')
    const llm = new FakeLlmClient(() => ({ inputTokens: 5, outputTokens: 3 }))
    const clientMessageId = crypto.randomUUID()

    const events = await collect(send(llm, { ...alice, clientMessageId, content: 'こんにちは' }))

    const sent = await db
      .select()
      .from(userMessages)
      .where(eq(userMessages.conversationId, alice.conversationId))
    expect(sent).toEqual([
      expect.objectContaining({ content: 'こんにちは', clientMessageId, status: 'completed' }),
    ])
    const replies = await db
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.userMessageId, sent[0]?.id ?? ''))
    expect(replies).toEqual([expect.objectContaining({ content: 'token1 token2 token3 ' })])
    expect(events).toEqual([
      { type: 'delta', text: 'token1 ' },
      { type: 'delta', text: 'token2 ' },
      { type: 'delta', text: 'token3 ' },
      { type: 'done', messageId: replies[0]?.id },
    ])
  })

  it('完了済みの client_message_id で再送したとき LLM を呼ばずに保存済みの応答を返す', async () => {
    const alice = await createUserWithConversation('alice')
    let llmCalls = 0
    const llm = new FakeLlmClient(() => {
      llmCalls++
      return { inputTokens: 5, outputTokens: 3 }
    })
    const input = { ...alice, clientMessageId: crypto.randomUUID(), content: 'こんにちは' }
    const firstEvents = await collect(send(llm, input))

    const retryEvents = await collect(send(llm, input))

    expect(retryEvents).toEqual([
      { type: 'delta', text: 'token1 token2 token3 ' },
      firstEvents.at(-1),
    ])
    expect(llmCalls).toBe(1)
    expect(await db.select().from(userMessages)).toHaveLength(1)
  })

  it('生成中の client_message_id で再送したとき（A の生成中に B を送る順にバリアで固定）B は生成中のエラーになり LLM は 1 回しか呼ばれない', async () => {
    const alice = await createUserWithConversation('alice')
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
    const input = { ...alice, clientMessageId: crypto.randomUUID(), content: 'こんにちは' }

    const sendA = collect(send(llm, input))
    const sendB = (async () => {
      await aStreaming.wait()
      try {
        return await collect(send(llm, input))
      } finally {
        bFinished.open()
      }
    })()
    const [eventsA, eventsB] = await Promise.all([sendA, sendB])

    expect(eventsB).toEqual([{ type: 'error', error: { type: 'message_in_progress' } }])
    expect(eventsA.at(-1)).toEqual({ type: 'done', messageId: expect.any(String) })
    expect(llmCalls).toBe(1)
  })

  it('失敗した client_message_id で再送したとき 同じ送信として再生成する', async () => {
    const alice = await createUserWithConversation('alice')
    const clientMessageId = crypto.randomUUID()
    const [failed] = await db
      .insert(userMessages)
      .values({
        conversationId: alice.conversationId,
        clientMessageId,
        content: 'こんにちは',
        status: 'failed',
      })
      .returning()
    if (!failed) throw new Error('準備: user_messages の INSERT が行を返しませんでした')
    const llm = new FakeLlmClient(() => ({ inputTokens: 5, outputTokens: 2 }))

    const events = await collect(send(llm, { ...alice, clientMessageId, content: 'こんにちは' }))

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
    const alice = await createUserWithConversation('alice')
    const clientMessageId = crypto.randomUUID()
    await db.insert(userMessages).values({
      conversationId: alice.conversationId,
      clientMessageId,
      content: 'こんにちは',
      status: 'failed',
    })
    const prompts: string[] = []
    const llm = new FakeLlmClient(({ prompt }) => {
      prompts.push(prompt)
      return { inputTokens: 5, outputTokens: 1 }
    })

    await collect(send(llm, { ...alice, clientMessageId, content: '別の本文' }))

    expect(prompts).toEqual(['こんにちは'])
    expect(await db.select().from(userMessages)).toEqual([
      expect.objectContaining({ content: 'こんにちは', status: 'completed' }),
    ])
  })

  it('失敗した送信への再送が同時に来たとき（A の再生成中に B を送る順にバリアで固定）B は生成中のエラーになり LLM は 1 回しか呼ばれない', async () => {
    const alice = await createUserWithConversation('alice')
    const clientMessageId = crypto.randomUUID()
    await db.insert(userMessages).values({
      conversationId: alice.conversationId,
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
    const input = { ...alice, clientMessageId, content: 'こんにちは' }

    const sendA = collect(send(llm, input))
    const sendB = (async () => {
      await aStreaming.wait()
      try {
        return await collect(send(llm, input))
      } finally {
        bFinished.open()
      }
    })()
    const [eventsA, eventsB] = await Promise.all([sendA, sendB])

    expect(eventsB).toEqual([{ type: 'error', error: { type: 'message_in_progress' } }])
    expect(eventsA.at(-1)).toEqual({ type: 'done', messageId: expect.any(String) })
    expect(llmCalls).toBe(1)
  })

  it('購読者がストリームの途中でやめたとき（クライアントの切断）生成は最後まで続き 応答は「完了」として保存される（再送は生成中ならエラー、完了後は保存済みの応答）', async () => {
    const alice = await createUserWithConversation('alice')
    const disconnected = createBarrier()
    let llmCalls = 0
    // 最初のチャンクを流したら、購読をやめるまで残りを流さない（やめた時点で必ず生成中にする）
    const llm: LlmClient = {
      async *stream() {
        llmCalls++
        yield { type: 'delta', text: 'token1 ' }
        await disconnected.wait()
        yield { type: 'delta', text: 'token2 ' }
        yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } }
      },
    }
    const input = { ...alice, clientMessageId: crypto.randomUUID(), content: 'こんにちは' }

    for await (const _ of send(llm, input)) {
      // 最初の delta を受け取ったところで購読をやめる
      break
    }
    // まだ生成中のうちに同じ ID で再送すると、生成中のエラーになる
    expect(await collect(send(llm, input))).toEqual([
      { type: 'error', error: { type: 'message_in_progress' } },
    ])
    // 購読をやめたあとで生成を再開させる。生成が購読から切り離されていなければ、誰も読み進めずに「生成中」のまま止まる
    disconnected.open()

    await vi.waitFor(
      async () => {
        expect(await db.select().from(userMessages)).toEqual([
          expect.objectContaining({ status: 'completed' }),
        ])
      },
      { timeout: 5_000 },
    )
    const replies = await db.select().from(assistantMessages)
    expect(replies).toEqual([expect.objectContaining({ content: 'token1 token2 ' })])

    // 完了後に同じ ID で再送すると、LLM を呼ばずに保存済みの応答全文が返る
    expect(await collect(send(llm, input))).toEqual([
      { type: 'delta', text: 'token1 token2 ' },
      { type: 'done', messageId: replies[0]?.id },
    ])
    expect(llmCalls).toBe(1)
  })

  it('他人の会話で完了済みの client_message_id で送信したとき その応答は返らず 新しい送信として生成する', async () => {
    const alice = await createUserWithConversation('alice')
    const bob = await createUserWithConversation('bob')
    let llmCalls = 0
    const llm = new FakeLlmClient(({ prompt }) => {
      llmCalls++
      // プロンプトごとに応答の長さを変え、誰の応答が返ったかを区別できるようにする
      return { inputTokens: 5, outputTokens: prompt === 'alice の相談' ? 3 : 1 }
    })
    // Alice と Bob が（クライアントのバグなどで）同じ client_message_id を使う
    const sharedClientMessageId = crypto.randomUUID()
    await collect(
      send(llm, { ...alice, clientMessageId: sharedClientMessageId, content: 'alice の相談' }),
    )

    const bobEvents = await collect(
      send(llm, { ...bob, clientMessageId: sharedClientMessageId, content: 'bob の相談' }),
    )

    expect(bobEvents.slice(0, -1)).toEqual([{ type: 'delta', text: 'token1 ' }])
    expect(llmCalls).toBe(2)
    expect(
      await db
        .select()
        .from(userMessages)
        .where(eq(userMessages.conversationId, bob.conversationId)),
    ).toEqual([expect.objectContaining({ content: 'bob の相談', status: 'completed' })])
  })

  it('他人の会話に送信したとき 会話が見つからないエラーになり 送信は保存されず LLM も呼ばれない', async () => {
    const alice = await createUserWithConversation('alice')
    const bob = await createUserWithConversation('bob')
    let llmCalls = 0
    const llm = new FakeLlmClient(() => {
      llmCalls++
      return { inputTokens: 5, outputTokens: 3 }
    })

    const events = await collect(
      send(llm, {
        userId: bob.userId,
        conversationId: alice.conversationId,
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      }),
    )

    // 会話の存在を他人に知らせないよう、存在しない会話と区別しない
    expect(events).toEqual([{ type: 'error', error: { type: 'conversation_not_found' } }])
    expect(await db.select().from(userMessages)).toEqual([])
    expect(llmCalls).toBe(0)
  })

  it('LLM がストリームの途中で切断したとき 届いたチャンクのあとに LLM 切断のエラーを返し 送信は「失敗」として保存される', async () => {
    const alice = await createUserWithConversation('alice')
    const llm = new FakeLlmClient(() => ({
      inputTokens: 5,
      outputTokens: 5,
      disconnectAfterChunks: 2,
    }))

    const events = await collect(
      send(llm, { ...alice, clientMessageId: crypto.randomUUID(), content: 'こんにちは' }),
    )

    expect(events).toEqual([
      { type: 'delta', text: 'token1 ' },
      { type: 'delta', text: 'token2 ' },
      { type: 'error', error: { type: 'llm_unavailable', cause: expect.anything() } },
    ])
    expect(await db.select().from(userMessages)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ])
    expect(await db.select().from(assistantMessages)).toEqual([])
  })

  it('生成中に想定外の例外が起きたとき その例外を投げ 送信は生成中のまま残らず「失敗」になる', async () => {
    const alice = await createUserWithConversation('alice')
    const bug = new Error('想定外のバグ')
    // 1 チャンク流したあとに例外を投げる LLM（ポートの約束に反する＝バグ）
    const llm: LlmClient = {
      async *stream() {
        yield { type: 'delta', text: 'token1 ' }
        throw bug
      },
    }

    await expect(
      collect(send(llm, { ...alice, clientMessageId: crypto.randomUUID(), content: 'こんにちは' })),
    ).rejects.toBe(bug)

    expect(await db.select().from(userMessages)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ])
  })
})
