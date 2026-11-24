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

  it('モデルの単価が登録されているとき その単価（単価表の行 ID 付き）を取得できる', async () => {
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

    const result = await createModelPriceRepository(db).findEffective({
      model: 'fake-model',
      at: new Date('2026-06-01T00:00:00Z'),
    })

    expect(result._unsafeUnwrap()).toEqual({
      id: price.id,
      inputPerMillionTokens: 3_000,
      outputPerMillionTokens: 15_000,
    })
  })
})
