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

// disconnected: ストリームの途中で接続が切れた（usage は得られない）
export type LlmError = { type: 'disconnected' }

// delta を 0 回以上流したあと、done（正常終了）か error（異常終了）のどちらか 1 つで必ず終わる。
// エラーは throw せず値として返す（neverthrow の方針と同じく、呼び出し側が型で分岐できるようにする）
export type LlmStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; stopReason: LlmStopReason; usage: LlmUsage }
  | { type: 'error'; error: LlmError }

export interface LlmClient {
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>
}
