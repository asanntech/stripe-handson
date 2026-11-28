import { truncateAllTables } from '@test/helpers/database'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { createConversationRepository } from '@/infrastructure/db/conversation-repository'
import { createMessageRepository } from '@/infrastructure/db/message-repository'
import { createModelPriceRepository } from '@/infrastructure/db/model-price-repository'
import {
  conversations,
  modelPrices,
  models,
  usageRecords,
  userMessages,
  users,
} from '@/infrastructure/db/schema'
import { FakeLlmClient } from '@/infrastructure/llm/fake-llm-client'
import type { LlmClient } from '@/usecases/ports/llm-client'
import { MODEL, type SendMessageEvent, type SendMessageInput, sendMessage } from './send-message'

describe('メッセージ送信の利用履歴（sendMessage）', () => {
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

  const createUserWithConversation = async () => {
    const [user] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!user) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: user.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    return { userId: user.id, conversationId: conversation.id }
  }

  const createModel = async () => {
    const [model] = await db.insert(models).values({ name: MODEL }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    return model
  }

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('応答が完了したとき 生成を始めた時刻で有効な単価で 利用履歴に入出力トークン数・適用した単価・消費クレジットが記録される', async () => {
    const alice = await createUserWithConversation()
    const model = await createModel()
    const [price] = await db
      .insert(modelPrices)
      .values([
        {
          modelId: model.id,
          inputPerMillionTokens: 3_000,
          outputPerMillionTokens: 15_000,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
        // まだ適用前の改定（ユースケースが今の時刻を渡していれば使われない）
        {
          modelId: model.id,
          inputPerMillionTokens: 6_000,
          outputPerMillionTokens: 30_000,
          effectiveFrom: new Date(Date.now() + 60 * 60 * 1000),
        },
      ])
      .returning()
    if (!price) throw new Error('準備: model_prices の INSERT が行を返しませんでした')
    const llm = new FakeLlmClient(() => ({ inputTokens: 1_000, outputTokens: 200 }))

    await collect(
      send(llm, { ...alice, clientMessageId: crypto.randomUUID(), content: 'こんにちは' }),
    )

    const [sent] = await db.select().from(userMessages)
    // 1,000 × 3,000 / 1,000,000 + 200 × 15,000 / 1,000,000 = 3 + 3 = 6（改定後の単価なら 6 + 6 = 12）
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

  it('LLM の切断で失敗した送信を同じ client_message_id で再送して再生成したとき 利用履歴は再生成の 1 件だけ記録される', async () => {
    const alice = await createUserWithConversation()
    const model = await createModel()
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
    const input = { ...alice, clientMessageId: crypto.randomUUID(), content: 'こんにちは' }
    const firstEvents = await collect(send(llm, input))
    expect(firstEvents.at(-1)).toMatchObject({ type: 'error', error: { type: 'llm_unavailable' } })

    await collect(send(llm, input))

    // 再生成の usage で 6 + 6 = 12
    expect(await db.select().from(usageRecords)).toEqual([
      expect.objectContaining({ inputTokens: 2_000, outputTokens: 400, credits: 12 }),
    ])
  })

  it('モデルの単価が未登録のとき LLM を呼ばずに単価がないエラーを返し 送信は「失敗」になる', async () => {
    const alice = await createUserWithConversation()
    let llmCalls = 0
    const llm = new FakeLlmClient(() => {
      llmCalls++
      return { inputTokens: 1_000, outputTokens: 200 }
    })

    const events = await collect(
      send(llm, { ...alice, clientMessageId: crypto.randomUUID(), content: 'こんにちは' }),
    )

    expect(events).toEqual([
      { type: 'error', error: { type: 'model_price_not_found', model: MODEL } },
    ])
    expect(llmCalls).toBe(0)
    expect(await db.select().from(userMessages)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ])
  })
})
