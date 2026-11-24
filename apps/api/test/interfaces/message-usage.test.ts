import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import {
  conversations,
  modelPrices,
  models,
  usageRecords,
  userMessages,
  users,
} from '@/infrastructure/db/schema'
import { FakeLlmClient } from '@/infrastructure/llm/fake-llm-client'
import { createHonoApp } from '@/interfaces/hono/app'
import { MODEL } from '@/usecases/send-message'
import { truncateAllTables } from '../helpers/database'
import { createTestRpcContext } from '../helpers/rpc-context'

describe('メッセージ送信の利用履歴', () => {
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

  it('応答が完了したとき 利用履歴に入出力トークン数・適用した単価・消費クレジットが記録される', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const [model] = await db.insert(models).values({ name: MODEL }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    const [price] = await db
      .insert(modelPrices)
      .values({
        modelId: model.id,
        inputPerMillionTokens: 3_000,
        outputPerMillionTokens: 15_000,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      })
      .returning()
    if (!price) throw new Error('準備: model_prices の INSERT が行を返しませんでした')
    const llm = new FakeLlmClient(() => ({ inputTokens: 1_000, outputTokens: 200 }))
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
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    })) {
      // 完了まで読み切る
    }

    const [sent] = await db.select().from(userMessages)
    // 1,000 × 3,000 / 1,000,000 + 200 × 15,000 / 1,000,000 = 3 + 3 = 6
    expect(await db.select().from(usageRecords)).toEqual([
      expect.objectContaining({
        userMessageId: sent?.id,
        modelPriceId: price.id,
        inputTokens: 1_000,
        outputTokens: 200,
        credits: 6,
      }),
    ])
  })

  it('送信したとき 生成を始めた時刻で有効な単価が利用履歴に記録される（まだ適用前の改定は使わない）', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const [model] = await db.insert(models).values({ name: MODEL }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    const oneHour = 60 * 60 * 1000
    const [current] = await db
      .insert(modelPrices)
      .values([
        {
          modelId: model.id,
          inputPerMillionTokens: 3_000,
          outputPerMillionTokens: 15_000,
          effectiveFrom: new Date(Date.now() - oneHour),
        },
        {
          modelId: model.id,
          inputPerMillionTokens: 6_000,
          outputPerMillionTokens: 30_000,
          effectiveFrom: new Date(Date.now() + oneHour),
        },
      ])
      .returning()
    if (!current) throw new Error('準備: model_prices の INSERT が行を返しませんでした')
    const llm = new FakeLlmClient(() => ({ inputTokens: 1_000, outputTokens: 200 }))
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
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    })) {
      // 完了まで読み切る
    }

    // 現行の単価で 3 + 3 = 6（改定後の単価なら 6 + 6 = 12）
    expect(await db.select().from(usageRecords)).toEqual([
      expect.objectContaining({ modelPriceId: current.id, credits: 6 }),
    ])
  })

  it('LLM の切断で失敗した送信を同じ client_message_id で再送して再生成したとき 利用履歴は再生成の 1 件だけ記録される', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const [model] = await db.insert(models).values({ name: MODEL }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    await db.insert(modelPrices).values({
      modelId: model.id,
      inputPerMillionTokens: 3_000,
      outputPerMillionTokens: 15_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    })
    // 1 回目は途中で切断し、2 回目（再生成）は最後まで返す
    let llmCalls = 0
    const llm = new FakeLlmClient(() => {
      llmCalls++
      return llmCalls === 1
        ? { inputTokens: 1_000, outputTokens: 200, disconnectAfterChunks: 1 }
        : { inputTokens: 2_000, outputTokens: 400 }
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
    await expect(async () => {
      for await (const _ of await client.messages.send(input)) {
        // 切断（502）まで読む
      }
    }).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' })

    for await (const _ of await client.messages.send(input)) {
      // 完了まで読み切る
    }

    // 再生成の usage で 6 + 6 = 12
    expect(await db.select().from(usageRecords)).toEqual([
      expect.objectContaining({ inputTokens: 2_000, outputTokens: 400, credits: 12 }),
    ])
  })

  it('モデルの単価が未登録のとき LLM を呼ばずに 500 を返し 送信は失敗になり 原因をサーバー側のログに出す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    let llmCalls = 0
    const llm = new FakeLlmClient(() => {
      llmCalls++
      return { inputTokens: 1_000, outputTokens: 200 }
    })
    const app = createHonoApp(createTestRpcContext({ db, llm }))
    const client: AppClient = createORPCClient(
      new RPCLink({
        url: 'http://localhost/api',
        headers: { 'x-user-id': alice.id },
        fetch: async (request) => app.fetch(request),
      }),
    )

    await expect(async () => {
      for await (const _ of await client.messages.send({
        conversationId: conversation.id,
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
      })) {
        // エラーまで読む
      }
    }).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', status: 500 })

    expect(llmCalls).toBe(0)
    expect(await db.select().from(userMessages)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ])
    expect(consoleError).toHaveBeenCalledWith(
      '[messages.send]',
      expect.objectContaining({
        status: 500,
        cause: { type: 'model_price_not_found', model: MODEL },
      }),
    )
  })
})
