import { setTimeout } from 'node:timers/promises'
import { sql } from 'drizzle-orm'
import type { Db } from '@/infrastructure/db/client'

type Options = { timeoutMs?: number; intervalMs?: number }

// 指定したバックエンド（pid）がロック待ち（pg_stat_activity.wait_event_type = 'Lock'）に入るまで待つ。
// バリアは「自分のコードがここまで来た」ことしか伝えられないため、
// DB 側でブロックされたことは別の接続（observer）から観測する。
// 対象の pid は、ブロックされる Tx の中で `SELECT pg_backend_pid()` して取得しておく。
export const waitUntilWaitingForLock = async (
  observer: Db,
  pid: number,
  { timeoutMs = 5_000, intervalMs = 10 }: Options = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const { rowCount } = await observer.execute(
      sql`SELECT 1 FROM pg_stat_activity WHERE pid = ${pid} AND wait_event_type = 'Lock'`,
    )
    if (rowCount === 1) return
    await setTimeout(intervalMs)
  }
  throw new Error(`pid ${pid} がロック待ちに入らないまま ${timeoutMs}ms 経過しました`)
}
