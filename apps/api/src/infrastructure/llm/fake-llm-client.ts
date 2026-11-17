import type { LlmClient, LlmRequest, LlmStreamEvent } from '@/usecases/ports/llm-client'

// リクエストごとの振る舞い。テストや開発時に、リクエストを見て返す内容を決める
export type FakeLlmScenario = {
  inputTokens: number
  outputTokens: number
}

// 実 LLM の代わりに、指定どおりのトークン数を 1 トークン 1 チャンクでストリームする
export class FakeLlmClient implements LlmClient {
  constructor(private readonly scenarioFor: (request: LlmRequest) => FakeLlmScenario) {}

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const { inputTokens, outputTokens } = this.scenarioFor(request)

    for (let i = 0; i < outputTokens; i++) {
      yield { type: 'delta', text: `token${i + 1} ` }
    }
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens, outputTokens } }
  }
}
