import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { getPgErrorCode } from '@/infrastructure/db/pg-error'
import { modelPrices, models } from '@/infrastructure/db/schema'
import { truncateAllTables } from '../../helpers/database'

describe('model_prices の制約', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('単価表の行を UPDATE しようとしたとき トリガーで拒否され 単価は変わらない', async () => {
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

    const error = await db
      .update(modelPrices)
      .set({ inputPerMillionTokens: 1_500 })
      .where(eq(modelPrices.id, price.id))
      .then(
        () => null,
        (caught: unknown) => caught,
      )

    // 23001: restrict_violation（改定は新しい適用開始日時の行を追加して行う）
    expect(getPgErrorCode(error)).toBe('23001')
    expect(await db.select().from(modelPrices)).toEqual([price])
  })

  it('単価表の行を DELETE しようとしたとき トリガーで拒否され 行は残る', async () => {
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

    const error = await db
      .delete(modelPrices)
      .where(eq(modelPrices.id, price.id))
      .then(
        () => null,
        (caught: unknown) => caught,
      )

    expect(getPgErrorCode(error)).toBe('23001')
    expect(await db.select().from(modelPrices)).toEqual([price])
  })

  it.each(['inputPerMillionTokens', 'outputPerMillionTokens'] as const)(
    '単価（%s）が負のとき CHECK 制約で拒否される',
    async (column) => {
      const [model] = await db.insert(models).values({ name: 'fake-model' }).returning()
      if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')

      const error = await db
        .insert(modelPrices)
        .values({
          modelId: model.id,
          inputPerMillionTokens: 3_000,
          outputPerMillionTokens: 15_000,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          [column]: -1,
        })
        .then(
          () => null,
          (caught: unknown) => caught,
        )

      // 23514: check_violation（負の単価は「使うと残高が増える」記録を生む）
      expect(getPgErrorCode(error)).toBe('23514')
      expect(await db.select().from(modelPrices)).toEqual([])
    },
  )
})
