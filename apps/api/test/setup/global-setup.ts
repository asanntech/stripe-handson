import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { truncateAllTables } from '../helpers/database'

// テスト実行前に 1 回だけ、テスト用 DB を最新スキーマへマイグレーションする
export default async function setup(): Promise<void> {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })
  try {
    // 前回の実行の最後のテストが残したデータを先に消す。残っていると、制約を追加するマイグレーションが
    // 既存の違反データ（例: Red の実行で入った重複行）で失敗するため
    await truncateAllTables(db)
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    })
  } finally {
    await db.$client.end()
  }
}
