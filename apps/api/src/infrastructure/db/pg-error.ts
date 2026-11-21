import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from 'pg'

// PostgreSQL のエラーコード（SQLSTATE）。必要になったものだけ追加する
// https://www.postgresql.org/docs/current/errcodes-appendix.html
export const PG_ERROR_CODE = {
  lockNotAvailable: '55P03',
} as const

// SQLSTATE は Drizzle ではなくドライバー（pg）の DatabaseError が持つ。
// Drizzle はそれを DrizzleQueryError の cause に包んで投げるため、包みを外してから判定する
export const getPgErrorCode = (error: unknown): string | null => {
  const pgError = error instanceof DrizzleQueryError ? error.cause : error
  return pgError instanceof DatabaseError ? (pgError.code ?? null) : null
}
