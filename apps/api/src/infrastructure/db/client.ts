import { drizzle } from 'drizzle-orm/node-postgres'
import type { PoolConfig } from 'pg'
import * as schema from './schema.js'

// DB アクセスの唯一の入口。接続プール（pg.Pool）は Drizzle が内部で作り、db.$client で参照できる
export const createDb = (connection: PoolConfig) =>
  drizzle({ connection, schema, casing: 'snake_case' })

export type Db = ReturnType<typeof createDb>
