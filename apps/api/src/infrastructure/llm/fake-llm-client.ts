import type { LlmClient, LlmRequest, LlmStreamEvent } from '@/usecases/ports/llm-client'

// リクエストごとの振る舞い。テストや開発時に、リクエストを見て返す内容を決める
export type FakeLlmScenario = {
  inputTokens: number
  // 生成したい出力トークン数（maxTokens を超える分は打ち切られる）
  outputTokens: number
}

// 実 LLM の代わりに、指定どおりのトークン数を 1 トークン 1 チャンクでストリームする
export class FakeLlmClient implements LlmClient {
  constructor(private readonly scenarioFor: (request: LlmRequest) => FakeLlmScenario) {}

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const scenario = this.scenarioFor(request)
    // 実 LLM と同様に、生成したい量が maxTokens を超える分は出力せず打ち切る
    const outputTokens = Math.min(scenario.outputTokens, request.maxTokens)
    const stopReason = scenario.outputTokens > request.maxTokens ? 'max_tokens' : 'end_turn'

    for (let i = 0; i < outputTokens; i++) {
      yield { type: 'delta', text: `token${i + 1} ` }
    }
    yield { type: 'done', stopReason, usage: { inputTokens: scenario.inputTokens, outputTokens } }
  }
}
