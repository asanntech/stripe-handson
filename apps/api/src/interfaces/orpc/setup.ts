import { implement } from '@orpc/server'
import { contract } from '@stripe-handson/contract'
import type { ResultAsync } from 'neverthrow'

// oRPC のセットアップ: contract を実装する procedure ビルダーと、全 procedure が共有するコンテキスト（注入される依存）
export type RpcContext = {
  checkDatabase: () => ResultAsync<void, { type: 'database_unavailable' }>
}

export const orpc = implement(contract).$context<RpcContext>()
