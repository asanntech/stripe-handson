import { err, ok, type Result } from '@/domain/result'
import type { RepositoryError } from '@/usecases/ports/repository-error'

// 例外 → Result の変換はインフラ層の境界だけで行う（plan.md「エラーハンドリング方針」）
export const tryQuery = async <T>(query: PromiseLike<T>): Promise<Result<T, RepositoryError>> => {
  try {
    return ok(await query)
  } catch (cause) {
    return err({ type: 'database_error', cause })
  }
}
