import { drizzle } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import * as schema from './schema.js'

export const createDb = (pool: pg.Pool) => drizzle(pool, { schema, casing: 'snake_case' })

export type Db = ReturnType<typeof createDb>
