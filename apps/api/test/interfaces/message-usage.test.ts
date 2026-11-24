import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppClient } from '@stripe-handson/contract'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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
})
