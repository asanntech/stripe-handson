import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb } from '@/infrastructure/db/client'

// テスト実行前に 1 回だけ、テスト用 DB を最新スキーマへマイグレーションする
export default async function setup(): Promise<void> {
  const db = createDb({ connectionString: process.env.TEST_DATABASE_URL })
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    })
  } finally {
    await db.$client.end()
  }
}
