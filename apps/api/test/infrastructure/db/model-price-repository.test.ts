import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { createModelPriceRepository } from '@/infrastructure/db/model-price-repository'
import { modelPrices, models } from '@/infrastructure/db/schema'
import { truncateAllTables } from '../../helpers/database'

describe('ModelPriceRepository: 有効な単価の取得', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('同じモデルに単価が複数登録されているとき 適用開始日時が最新の単価を取得する', async () => {
    const [model] = await db.insert(models).values({ name: 'fake-model' }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    const [, revised] = await db
      .insert(modelPrices)
      .values([
        {
          modelId: model.id,
          inputPerMillionTokens: 3_000,
          outputPerMillionTokens: 15_000,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
        {
          modelId: model.id,
          inputPerMillionTokens: 2_000,
          outputPerMillionTokens: 10_000,
          effectiveFrom: new Date('2026-04-01T00:00:00Z'),
        },
      ])
      .returning()
    if (!revised) throw new Error('準備: model_prices の INSERT が行を返しませんでした')

    const result = await createModelPriceRepository(db).findEffective({
      model: 'fake-model',
      at: new Date('2026-06-01T00:00:00Z'),
    })

    expect(result).toEqual({
      id: revised.id,
      inputPerMillionTokens: 2_000,
      outputPerMillionTokens: 10_000,
    })
  })

  it('未来の日時から適用される改定があるとき それを使わず 指定時刻に有効な単価を取得する', async () => {
    const [model] = await db.insert(models).values({ name: 'fake-model' }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    const [current] = await db
      .insert(modelPrices)
      .values([
        {
          modelId: model.id,
          inputPerMillionTokens: 3_000,
          outputPerMillionTokens: 15_000,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
        {
          modelId: model.id,
          inputPerMillionTokens: 2_000,
          outputPerMillionTokens: 10_000,
          effectiveFrom: new Date('2026-07-01T00:00:00Z'),
        },
      ])
      .returning()
    if (!current) throw new Error('準備: model_prices の INSERT が行を返しませんでした')

    const result = await createModelPriceRepository(db).findEffective({
      model: 'fake-model',
      at: new Date('2026-06-01T00:00:00Z'),
    })

    expect(result).toEqual({
      id: current.id,
      inputPerMillionTokens: 3_000,
      outputPerMillionTokens: 15_000,
    })
  })

  it('指定時刻が適用開始日時ちょうどのとき 新しい単価を取得する', async () => {
    const [model] = await db.insert(models).values({ name: 'fake-model' }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    const [, revised] = await db
      .insert(modelPrices)
      .values([
        {
          modelId: model.id,
          inputPerMillionTokens: 3_000,
          outputPerMillionTokens: 15_000,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
        {
          modelId: model.id,
          inputPerMillionTokens: 2_000,
          outputPerMillionTokens: 10_000,
          effectiveFrom: new Date('2026-07-01T00:00:00Z'),
        },
      ])
      .returning()
    if (!revised) throw new Error('準備: model_prices の INSERT が行を返しませんでした')

    const result = await createModelPriceRepository(db).findEffective({
      model: 'fake-model',
      at: new Date('2026-07-01T00:00:00Z'),
    })

    expect(result).toEqual({
      id: revised.id,
      inputPerMillionTokens: 2_000,
      outputPerMillionTokens: 10_000,
    })
  })
})
