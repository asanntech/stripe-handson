import { describe, expect, it } from 'vitest'
import { FakeLlmClient } from '../../../src/infrastructure/llm/fake-llm-client.js'
import type { LlmStreamEvent } from '../../../src/usecases/ports/llm-client.js'

const collect = async (stream: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> => {
  const events: LlmStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('FakeLlmClient', () => {
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
})
