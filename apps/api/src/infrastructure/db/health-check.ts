import { sql } from 'drizzle-orm'
import { err, ok, type Result } from '@/domain/result'
import type { Db } from './client'

export type DatabaseUnavailableError = { type: 'database_unavailable'; cause: unknown }

// 例外 → Result の変換はインフラ層の境界で行う（plan.md「エラーハンドリング方針」）
export const createDatabaseHealthCheck =
  (db: Db) => async (): Promise<Result<void, DatabaseUnavailableError>> => {
    try {
      await db.execute(sql`SELECT 1`)
      return ok(undefined)
    } catch (cause) {
      return err({ type: 'database_unavailable', cause })
    }
  }
