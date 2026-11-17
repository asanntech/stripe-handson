// LLM 呼び出しのポート。ユースケースはこのインターフェースだけに依存する
export type LlmRequest = {
  model: string
  prompt: string
  maxTokens: number
}

export type LlmUsage = {
  inputTokens: number
  outputTokens: number
}

export type LlmStopReason = 'end_turn'

export type LlmStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; stopReason: LlmStopReason; usage: LlmUsage }

export interface LlmClient {
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>
}
