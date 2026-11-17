import { sql } from 'drizzle-orm'
import type { Db } from './client'

export const createDatabaseHealthCheck = (db: Db) => async (): Promise<void> => {
  await db.execute(sql`SELECT 1`)
}
