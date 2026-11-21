import { drizzle } from 'drizzle-orm/node-postgres'
import type { PoolConfig } from 'pg'
import * as schema from './schema'

// DB アクセスの唯一の入口。接続プール（pg.Pool）は Drizzle が内部で作り、db.$client で参照できる
export const createDb = (connection: PoolConfig) =>
  drizzle({ connection, schema, casing: 'snake_case' })

export type Db = ReturnType<typeof createDb>

// db.transaction() のコールバックが受け取る Tx
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]

// リポジトリはどちらでも動く（Tx を渡せば、その Tx の中でクエリを実行する）
export type DbExecutor = Db | DbTransaction
