import { ORPCError } from '@orpc/server'
import { sendMessage } from '@/usecases/send-message'
import { authedOrpc, orpc } from './setup'

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
    create: authedOrpc.conversations.create.handler(async ({ context }) => {
      const result = await context.conversations.create(context.userId)
      if (result.isErr()) throw new ORPCError('INTERNAL_SERVER_ERROR', { cause: result.error })
      return { conversationId: result.value.id }
    }),
  },
  messages: {
    send: authedOrpc.messages.send.handler(async function* ({ input, context, errors }) {
      const events = sendMessage(
        { conversations: context.conversations, messages: context.messages, llm: context.llm },
        { ...input, userId: context.userId },
      )
      for await (const event of events) {
        if (event.type !== 'error') {
          yield event
          continue
        }
        // ユースケースのエラーを全種類列挙する（新しいエラーを足して変換し忘れると typecheck で止まる）
        const error = event.error
        switch (error.type) {
          case 'conversation_not_found':
            throw errors.CONVERSATION_NOT_FOUND()
          case 'message_in_progress':
            throw errors.MESSAGE_IN_PROGRESS()
          case 'llm_unavailable':
            throw errors.LLM_UNAVAILABLE({ cause: error })
          case 'database_error':
          case 'duplicate_reply':
            throw new ORPCError('INTERNAL_SERVER_ERROR', { cause: error })
          default:
            throw error satisfies never
        }
      }
    }),
  },
})
