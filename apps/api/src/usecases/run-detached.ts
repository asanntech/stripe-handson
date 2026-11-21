// source を購読者から切り離して最後まで走らせ、そのイベントを購読するイテレータを返す。
// 購読者が途中でやめても（例: クライアントの切断）source は止まらない。
// 送信では、切断しても生成を続けて応答を保存し、LLM の usage を必ず得るために使う
export function runDetached<T>(source: AsyncIterable<T>): AsyncGenerator<T> {
  // 生成側（バックグラウンド）と購読側で共有する状態
  const state: {
    buffer: T[]
    finished: boolean
    failure: { error: unknown } | null
    wake: (() => void) | null
  } = { buffer: [], finished: false, failure: null, wake: null }
  const notify = () => {
    state.wake?.()
    state.wake = null
  }

  void (async () => {
    try {
      for await (const event of source) {
        state.buffer.push(event)
        notify()
      }
    } catch (error) {
      // 想定外の例外（バグ）は購読側へ渡して投げ直す（購読をやめていたら届かない）
      state.failure = { error }
    } finally {
      state.finished = true
      notify()
    }
  })()

  return (async function* () {
    while (true) {
      const event = state.buffer.shift()
      if (event !== undefined) {
        yield event
        continue
      }
      if (state.failure !== null) throw state.failure.error
      if (state.finished) return
      await new Promise<void>((resolve) => {
        state.wake = resolve
      })
    }
  })()
}
