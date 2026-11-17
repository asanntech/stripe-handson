import { implement } from '@orpc/server'
import { contract } from '@stripe-handson/contract'

// oRPC のセットアップ: contract を実装する procedure ビルダーと、全 procedure が共有するコンテキスト（注入される依存）
export type RpcContext = {
  checkDatabase: () => Promise<void>
}

export const orpc = implement(contract).$context<RpcContext>()
