import { sql } from 'drizzle-orm'
import type { Db } from '@/infrastructure/db/client'

// public スキーマの全テーブルを空にする（drizzle のマイグレーション履歴は drizzle スキーマなので対象外）
export const truncateAllTables = async (db: Db): Promise<void> => {
  // 誤って開発用 DB などに向けたときに全データを消さないよう、テスト用 DB（*_test）以外では止める
  const { rows: current } = await db.execute<{ name: string }>(
    sql`SELECT current_database() AS name`,
  )
  const name = current[0]?.name ?? ''
  if (!name.endsWith('_test')) {
    throw new Error(`テスト用 DB（名前が _test で終わる DB）以外は TRUNCATE しません: ${name}`)
  }

  const { rows } = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  )
  if (rows.length === 0) return

  const tables = rows.map(({ tablename }) => `"public"."${tablename}"`).join(', ')
  await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`))
}
