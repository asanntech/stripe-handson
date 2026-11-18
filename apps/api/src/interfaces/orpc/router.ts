import { ORPCError } from '@orpc/server'
import { orpc } from './setup'

export const router = orpc.router({
  health: {
    check: orpc.health.check.handler(async ({ context, errors }) => {
      const result = await context.checkDatabase()
      // ドメイン / インフラのエラーは、ここで contract に定義した型付きエラーへ変換する
      // 原因は cause に持たせるだけ。ログは hono/app.ts の onError インターセプターが出す（クライアントには返らない）
      if (result.isErr()) throw errors.SERVICE_UNAVAILABLE({ cause: result.error })
      return { status: 'ok', database: 'ok' }
    }),
  },
  conversations: {
    create: orpc.conversations.create.handler(async ({ context }) => {
      const result = await context.conversations.create(context.userId ?? '')
      if (result.isErr()) throw new ORPCError('INTERNAL_SERVER_ERROR', { cause: result.error })
      return { conversationId: result.value.id }
    }),
  },
  messages: {
    send: orpc.messages.send.handler(async function* ({ input, context }) {
      const stream = context.llm.stream({
        model: 'fake-model',
        prompt: input.content,
        maxTokens: 1024,
      })
      for await (const event of stream) {
        if (event.type === 'delta') yield { type: 'delta', text: event.text }
      }
      yield { type: 'done', messageId: crypto.randomUUID() }
    }),
  },
})
