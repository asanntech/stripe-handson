import { implement, ORPCError } from '@orpc/server'
import { contract } from '@stripe-handson/contract'
import { z } from 'zod'
import type { Result } from '@/domain/result'
import type { authenticate } from '@/usecases/authenticate'
import type { createConversation } from '@/usecases/create-conversation'
import type { sendMessage } from '@/usecases/send-message'

// oRPC のセットアップ: contract を実装する procedure ビルダー（orpc / 認証済みの authedOrpc）と、
// handler.handle() に渡す Initial Context（コンポジションルートで依存を束ねたユースケース）。
// リポジトリは入れない。どのユースケースがどのリポジトリを使うかは server.ts に一覧で並ぶ
export type RpcContext = {
  checkDatabase: () => Promise<Result<void, { type: 'database_unavailable'; cause: unknown }>>
  authenticate: Bound<typeof authenticate>
  createConversation: Bound<typeof createConversation>
  sendMessage: Bound<typeof sendMessage>
}

// ユースケースの関数の型から第 1 引数（deps）を除いた、依存を束ねたあとの型。
// 入出力の型はユースケース側の定義を正とし、ここで書き直さない
type Bound<F> = F extends (deps: never, ...args: infer A) => infer R ? (...args: A) => R : never

// リクエストのヘッダーは Hono のアプリ（hono/app.ts）が Initial Context に足す
export const orpc = implement(contract).$context<RpcContext & { headers: Headers }>()

const userIdSchema = z.uuid()

// 簡易認証（plan.md: 認証はスコープ外）: X-User-Id の形式をここで検証し、実在の確認は authenticate ユースケースに任せる。
// 認証できたら、その ID を Execution Context に足す
export const authedOrpc = orpc.use(async ({ context, next }) => {
  const parsed = userIdSchema.safeParse(context.headers.get('x-user-id'))
  if (!parsed.success) throw new ORPCError('UNAUTHORIZED')
  const result = await context.authenticate({ userId: parsed.data })
  if (!result.ok) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { userId: result.value.userId } })
})
