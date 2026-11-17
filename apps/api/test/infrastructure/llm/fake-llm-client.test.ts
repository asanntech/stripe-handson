import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeLlmClient } from '@/infrastructure/llm/fake-llm-client'
import type { LlmStreamEvent } from '@/usecases/ports/llm-client'

const collect = async (stream: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> => {
  const events: LlmStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('FakeLlmClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('出力トークン数を指定したとき その数のトークンをチャンクでストリームし usage を返す', async () => {
    const llm = new FakeLlmClient(() => ({ inputTokens: 7, outputTokens: 3 }))

    const events = await collect(
      llm.stream({ model: 'fake-model', prompt: 'こんにちは', maxTokens: 100 }),
    )

    expect(events.filter((e) => e.type === 'delta')).toHaveLength(3)
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'end_turn',
      usage: { inputTokens: 7, outputTokens: 3 },
    })
  })

  it('出力トークン数が 0 のとき チャンクを流さず usage だけを返す', async () => {
    const llm = new FakeLlmClient(() => ({ inputTokens: 2, outputTokens: 0 }))

    const events = await collect(llm.stream({ model: 'fake-model', prompt: 'hi', maxTokens: 100 }))

    expect(events).toEqual([
      { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 0 } },
    ])
  })

  it('max_tokens を指定出力数が超えるとき max_tokens で打ち切り 終了理由を長さ上限として返す', async () => {
    const llm = new FakeLlmClient(() => ({ inputTokens: 4, outputTokens: 10 }))

    const events = await collect(llm.stream({ model: 'fake-model', prompt: 'hi', maxTokens: 3 }))

    expect(events.filter((e) => e.type === 'delta')).toHaveLength(3)
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'max_tokens',
      usage: { inputTokens: 4, outputTokens: 3 },
    })
  })

  it('指定出力数が max_tokens とちょうど等しいとき 打ち切らず end_turn で返す', async () => {
    const llm = new FakeLlmClient(() => ({ inputTokens: 4, outputTokens: 3 }))

    const events = await collect(llm.stream({ model: 'fake-model', prompt: 'hi', maxTokens: 3 }))

    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'end_turn',
      usage: { inputTokens: 4, outputTokens: 3 },
    })
  })

  it('チャンク間遅延を指定したとき 各チャンクがその間隔で届く', async () => {
    vi.useFakeTimers()
    const llm = new FakeLlmClient(() => ({ inputTokens: 1, outputTokens: 2, chunkDelayMs: 100 }))
    const stream = llm
      .stream({ model: 'fake-model', prompt: 'hi', maxTokens: 10 })
      [Symbol.asyncIterator]()
    const received: string[] = []
    const next = () => stream.next().then((r) => received.push(r.done ? 'end' : r.value.type))

    const first = next()
    await vi.advanceTimersByTimeAsync(99)
    expect(received).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await first
    expect(received).toEqual(['delta'])

    const second = next()
    await vi.advanceTimersByTimeAsync(99)
    expect(received).toEqual(['delta'])
    await vi.advanceTimersByTimeAsync(1)
    await second
    expect(received).toEqual(['delta', 'delta'])
  })
})
