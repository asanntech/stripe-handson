import { desc, eq } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import type { ModelPriceRepository } from '@/usecases/ports/model-price-repository'
import type { RepositoryError } from '@/usecases/ports/repository-error'
import type { DbExecutor } from './client'
import { modelPrices, models } from './schema'

export const createModelPriceRepository = (db: DbExecutor): ModelPriceRepository => ({
  findEffective: ({ model }) =>
    ResultAsync.fromPromise(
      db
        .select({
          id: modelPrices.id,
          inputPerMillionTokens: modelPrices.inputPerMillionTokens,
          outputPerMillionTokens: modelPrices.outputPerMillionTokens,
        })
        .from(modelPrices)
        .innerJoin(models, eq(models.id, modelPrices.modelId))
        .where(eq(models.name, model))
        .orderBy(desc(modelPrices.effectiveFrom))
        .limit(1),
      (cause): RepositoryError => ({ type: 'database_error', cause }),
    ).map(([row]) => row ?? null),
})
