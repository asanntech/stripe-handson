import { setTimeout } from 'node:timers/promises'
import type pg from 'pg'

type Options = { timeoutMs?: number; intervalMs?: number }

// 指定した接続がロック待ち（pg_stat_activity.wait_event_type = 'Lock'）に入るまで待つ。
// バリアは「自分のコードがここまで来た」ことしか伝えられないため、
// DB 側でブロックされたことは別の接続（observer）から観測する。
export const waitUntilWaitingForLock = async (
  observer: pg.Pool,
  blocked: pg.PoolClient,
  { timeoutMs = 5_000, intervalMs = 10 }: Options = {},
): Promise<void> => {
  const pid = (blocked as pg.PoolClient & { processID: number }).processID
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const { rowCount } = await observer.query(
      "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
      [pid],
    )
    if (rowCount === 1) return
    await setTimeout(intervalMs)
  }
  throw new Error(`pid ${pid} がロック待ちに入らないまま ${timeoutMs}ms 経過しました`)
}
