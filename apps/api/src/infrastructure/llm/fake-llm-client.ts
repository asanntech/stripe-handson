import type { LlmClient, LlmRequest, LlmStreamEvent } from '@/usecases/ports/llm-client'

// リクエストごとの振る舞い。テストや開発時に、リクエストを見て返す内容を決める
export type FakeLlmScenario = {
  inputTokens: number
  // 生成したい出力トークン数（maxTokens を超える分は打ち切られる）
  outputTokens: number
  // 各チャンクを流す前に待つ時間（ストリーミングの遅さを再現する）。省略時は待たない
  chunkDelayMs?: number
  // 指定した数のチャンクを流した直後に切断する（出力数と同じなら done の直前）。省略時は切断しない
  disconnectAfterChunks?: number
}

// グローバルの setTimeout を使う（テストで vi.useFakeTimers() により時間を進められるようにするため）
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// 実 LLM の代わりに、指定どおりのトークン数を 1 トークン 1 チャンクでストリームする
export class FakeLlmClient implements LlmClient {
  constructor(private readonly scenarioFor: (request: LlmRequest) => FakeLlmScenario) {}

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const scenario = this.scenarioFor(request)
    // 実 LLM と同様に、生成したい量が maxTokens を超える分は出力せず打ち切る
    const outputTokens = Math.min(scenario.outputTokens, request.maxTokens)
    const stopReason = scenario.outputTokens > request.maxTokens ? 'max_tokens' : 'end_turn'

    // 切断位置が出力数以内なら、そこまでのチャンクだけ流して done の代わりに error で終わる。
    // 切断位置 === 出力数は「本文は全部届いたが usage が届かない」状況を再現する
    const disconnectAt = scenario.disconnectAfterChunks
    const disconnects = disconnectAt !== undefined && disconnectAt <= outputTokens
    const chunkCount = disconnects ? disconnectAt : outputTokens

    for (let i = 0; i < chunkCount; i++) {
      if (scenario.chunkDelayMs) await sleep(scenario.chunkDelayMs)
      yield { type: 'delta', text: `token${i + 1} ` }
    }
    if (disconnects) {
      yield { type: 'error', error: { type: 'disconnected' } }
      return
    }
    yield { type: 'done', stopReason, usage: { inputTokens: scenario.inputTokens, outputTokens } }
  }
}
