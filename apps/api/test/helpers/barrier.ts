// 並行処理の実行順序をテストで決定的に固定するための一度きりのバリア。
// 例: B が `await barrier.wait()` で待ち、A が処理を終えたら `barrier.open()` する。
export type Barrier = {
  wait: () => Promise<void>
  open: () => void
}

export const createBarrier = (): Barrier => {
  const { promise, resolve } = Promise.withResolvers<void>()
  return {
    wait: () => promise,
    open: () => resolve(),
  }
}
