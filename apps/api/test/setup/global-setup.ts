import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

// テスト実行前に 1 回だけ、テスト用 DB を最新スキーマへマイグレーションする
export default async function setup(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    })
  } finally {
    await pool.end()
  }
}
