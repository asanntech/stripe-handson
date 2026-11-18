import { implement } from '@orpc/server'
import { contract } from '@stripe-handson/contract'
import type { ResultAsync } from 'neverthrow'
import type { ConversationRepository } from '@/usecases/ports/conversation-repository'
import type { LlmClient } from '@/usecases/ports/llm-client'
import type { MessageRepository } from '@/usecases/ports/message-repository'

// oRPC のセットアップ: contract を実装する procedure ビルダーと、
// handler.handle() に渡す Initial Context（全 procedure が共有する、注入される依存）
export type RpcContext = {
  checkDatabase: () => ResultAsync<void, { type: 'database_unavailable'; cause: unknown }>
  conversations: ConversationRepository
  messages: MessageRepository
  llm: LlmClient
}

// TODO(401 のサイクル): userId は認証ミドルウェアが X-User-Id から足す Execution Context に置き換える
export const orpc = implement(contract).$context<RpcContext & { userId: string | null }>()
