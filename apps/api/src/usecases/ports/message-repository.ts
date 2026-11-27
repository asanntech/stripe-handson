import type { Result } from '@/domain/result'

export type NewUserMessage = {
  conversationId: string
  clientMessageId: string
  content: string
}

// 同じ会話・同じ client_message_id の送信がすでにある（UNIQUE (conversation_id, client_message_id)）
export type DuplicateClientMessageError = { type: 'duplicate_client_message' }

// 同じ送信の応答がすでに保存されている（UNIQUE (user_message_id)）
export type DuplicateReplyError = { type: 'duplicate_reply' }

export type SentMessage = {
  id: string
  status: 'generating' | 'completed' | 'failed'
  // 受け付けたときの本文（再生成はこの本文で行う）
  content: string
  // 応答は完了したときだけある
  reply: { id: string; content: string } | null
}

// 応答 1 つ分の利用記録（適用した単価は単価表の行 ID で参照する）
export type NewUsageRecord = {
  modelPriceId: string
  inputTokens: number
  outputTokens: number
  credits: number
}

// 業務上の意味がある制約違反（重複）だけを Result で返し、想定外の DB エラーは例外のまま投げる
export interface MessageRepository {
  // 送信を「生成中」として受け付ける
  createUserMessage(
    message: NewUserMessage,
  ): Promise<Result<{ id: string }, DuplicateClientMessageError>>
  findByClientMessageId(key: {
    conversationId: string
    clientMessageId: string
  }): Promise<SentMessage | null>
  // 「失敗」の送信を「生成中」に戻す（条件付き UPDATE）。同時に呼ばれても true になるのは 1 つだけ
  claimFailedForRetry(userMessageId: string): Promise<boolean>
  // 「生成中」の送信を「失敗」にする（応答を保存できずに生成が終わったとき）
  markFailed(userMessageId: string): Promise<void>
  // 応答と利用記録を保存し、送信を「完了」にする
  complete(reply: {
    userMessageId: string
    content: string
    usage: NewUsageRecord
  }): Promise<Result<{ id: string }, DuplicateReplyError>>
}
