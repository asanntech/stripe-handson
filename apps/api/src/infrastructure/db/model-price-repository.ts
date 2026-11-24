import { and, desc, eq, lte } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import type { ModelPriceRepository } from '@/usecases/ports/model-price-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'
import type { DbExecutor } from './client'
import { modelPrices, models } from './schema'

export const createModelPriceRepository = (db: DbExecutor): ModelPriceRepository => ({
  findEffective: ({ model, at }) =>
    ResultAsync.fromPromise(
      db
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
        .limit(1),
      (cause): RepositoryError => ({ type: 'database_error', cause }),
    ).map(([row]) => row ?? null),
})
