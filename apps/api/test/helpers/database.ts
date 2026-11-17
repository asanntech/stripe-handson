import { sql } from 'drizzle-orm'
import type { Db } from '../../src/infrastructure/db/client.js'

// public スキーマの全テーブルを空にする（drizzle のマイグレーション履歴は drizzle スキーマなので対象外）
export const truncateAllTables = async (db: Db): Promise<void> => {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  )
  if (rows.length === 0) return

  const tables = rows.map(({ tablename }) => `"public"."${tablename}"`).join(', ')
  await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`))
}
