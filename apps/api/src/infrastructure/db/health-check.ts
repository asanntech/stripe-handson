import { sql } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import type { Db } from './client'

export type DatabaseUnavailableError = { type: 'database_unavailable'; cause: unknown }

// 例外 → Result の変換はインフラ層の境界で行う（plan.md「エラーハンドリング方針」）
export const createDatabaseHealthCheck =
  (db: Db) => (): ResultAsync<void, DatabaseUnavailableError> =>
    ResultAsync.fromPromise(
      db.execute(sql`SELECT 1`),
      (cause): DatabaseUnavailableError => ({ type: 'database_unavailable', cause }),
    ).map(() => undefined)
