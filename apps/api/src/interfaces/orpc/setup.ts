import { implement } from '@orpc/server'
import { contract } from '@stripe-handson/contract'
import type { ResultAsync } from 'neverthrow'
import type { ConversationRepository } from '@/usecases/ports/conversation-repository'

// oRPC のセットアップ: contract を実装する procedure ビルダーと、全 procedure が共有するコンテキスト（注入される依存）
export type RpcDeps = {
  checkDatabase: () => ResultAsync<void, { type: 'database_unavailable'; cause: unknown }>
  conversations: ConversationRepository
}

// リクエストごとの情報（X-User-Id ヘッダー）を依存に加えたもの
export type RpcContext = RpcDeps & { userId: string | undefined }

export const orpc = implement(contract).$context<RpcContext>()
