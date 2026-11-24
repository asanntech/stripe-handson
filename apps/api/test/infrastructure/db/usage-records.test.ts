import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { getPgErrorCode } from '@/infrastructure/db/pg-error'
import {
  conversations,
  modelPrices,
  models,
  usageRecords,
  userMessages,
  users,
} from '@/infrastructure/db/schema'
import { truncateAllTables } from '../../helpers/database'

describe('usage_records の制約', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('同じ送信の利用履歴を二重に INSERT したとき UNIQUE 制約で拒否される', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const [message] = await db
      .insert(userMessages)
      .values({
        conversationId: conversation.id,
        clientMessageId: crypto.randomUUID(),
        content: 'こんにちは',
        status: 'generating',
      })
      .returning()
    if (!message) throw new Error('準備: user_messages の INSERT が行を返しませんでした')
    const [model] = await db.insert(models).values({ name: 'fake-model' }).returning()
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
    const usage = {
      userMessageId: message.id,
      modelPriceId: price.id,
      inputTokens: 10,
      outputTokens: 30,
      credits: 1,
    }
    await db.insert(usageRecords).values(usage)

    const error = await db
      .insert(usageRecords)
      .values(usage)
      .then(
        () => null,
        (caught: unknown) => caught,
      )

    // 23505: unique_violation（二重課金を DB が最後の砦として止める）
    expect(getPgErrorCode(error)).toBe('23505')
    expect(await db.select().from(usageRecords)).toHaveLength(1)
  })
})
