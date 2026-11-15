import type pg from 'pg'

// public スキーマの全テーブルを空にする（drizzle のマイグレーション履歴は drizzle スキーマなので対象外）
export const truncateAllTables = async (pool: pg.Pool): Promise<void> => {
  const { rows } = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  )
  if (rows.length === 0) return

  const tables = rows.map(({ tablename }) => `"public"."${tablename}"`).join(', ')
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`)
}
