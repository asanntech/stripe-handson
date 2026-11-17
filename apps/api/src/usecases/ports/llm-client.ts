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

// end_turn: 生成が自然に終わった / max_tokens: maxTokens に達して打ち切られた
export type LlmStopReason = 'end_turn' | 'max_tokens'

export type LlmStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; stopReason: LlmStopReason; usage: LlmUsage }

export interface LlmClient {
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>
}
