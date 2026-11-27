import { and, desc, eq, lte } from 'drizzle-orm'
import type { ModelPriceRepository } from '@/usecases/ports/model-price-repository'
import type { DbExecutor } from './client'
import { modelPrices, models } from './schema'

export const createModelPriceRepository = (db: DbExecutor): ModelPriceRepository => ({
  findEffective: async ({ model, at }) => {
    const [row] = await db
      .select({
        id: modelPrices.id,
        inputPerMillionTokens: modelPrices.inputPerMillionTokens,
        outputPerMillionTokens: modelPrices.outputPerMillionTokens,
      })
      .from(modelPrices)
      .innerJoin(models, eq(models.id, modelPrices.modelId))
      // 適用開始済みのうち最新の 1 行（未来の日時から適用される改定は使わない）
      .where(and(eq(models.name, model), lte(modelPrices.effectiveFrom, at)))
      .orderBy(desc(modelPrices.effectiveFrom))
      .limit(1)
    return row ?? null
  },
})
