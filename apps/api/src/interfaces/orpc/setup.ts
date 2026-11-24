import { implement, ORPCError } from '@orpc/server'
import { contract } from '@stripe-handson/contract'
import type { ResultAsync } from 'neverthrow'
import { z } from 'zod'
import type { ConversationRepository } from '@/usecases/ports/conversation-repository'
import type { LlmClient } from '@/usecases/ports/llm-client'
import type { MessageRepository } from '@/usecases/ports/message-repository'
import type { ModelPriceRepository } from '@/usecases/ports/model-price-repository'
import type { UserRepository } from '@/usecases/ports/user-repository'

// oRPC のセットアップ: contract を実装する procedure ビルダー（orpc / 認証済みの authedOrpc）と、
// handler.handle() に渡す Initial Context（全 procedure が共有する、注入される依存）
export type RpcContext = {
  checkDatabase: () => ResultAsync<void, { type: 'database_unavailable'; cause: unknown }>
  users: UserRepository
  conversations: ConversationRepository
  messages: MessageRepository
  modelPrices: ModelPriceRepository
  llm: LlmClient
}

// リクエストのヘッダーは Hono のアプリ（hono/app.ts）が Initial Context に足す
export const orpc = implement(contract).$context<RpcContext & { headers: Headers }>()

const userIdSchema = z.uuid()

// 簡易認証（plan.md: 認証はスコープ外）: X-User-Id が実在するユーザーなら、その ID を Execution Context に足す
export const authedOrpc = orpc.use(async ({ context, next }) => {
  const parsed = userIdSchema.safeParse(context.headers.get('x-user-id'))
  if (!parsed.success) throw new ORPCError('UNAUTHORIZED')
  const exists = await context.users.exists(parsed.data)
  if (exists.isErr()) throw new ORPCError('INTERNAL_SERVER_ERROR', { cause: exists.error })
  if (!exists.value) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { userId: parsed.data } })
})
