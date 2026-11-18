import { ORPCError } from '@orpc/server'
import { sendMessage } from '@/usecases/send-message'
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
    send: orpc.messages.send.handler(async function* ({ input, context, errors }) {
      const events = sendMessage({ messages: context.messages, llm: context.llm }, input)
      for await (const event of events) {
        if (event.type === 'error') {
          if (event.error.type === 'message_in_progress') throw errors.MESSAGE_IN_PROGRESS()
          throw new ORPCError('INTERNAL_SERVER_ERROR', { cause: event.error })
        }
        yield event
      }
    }),
  },
})
