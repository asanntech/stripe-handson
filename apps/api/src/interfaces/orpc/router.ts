import { ORPCError } from '@orpc/server'
import { authedOrpc, orpc } from './setup'

export const router = orpc.router({
  health: {
    check: orpc.health.check.handler(async ({ context, errors }) => {
      const result = await context.checkDatabase()
      // ドメイン / インフラのエラーは、ここで contract に定義した型付きエラーへ変換する
      // 原因は cause に持たせるだけ。ログは logServerErrorInterceptor（orpc/log-server-error.ts）が出す（クライアントには返らない）
      if (!result.ok) throw errors.SERVICE_UNAVAILABLE({ cause: result.error })
      return { status: 'ok', database: 'ok' }
    }),
  },
  conversations: {
    create: authedOrpc.conversations.create.handler(({ context }) =>
      context.createConversation({ userId: context.userId }),
    ),
  },
  messages: {
    send: authedOrpc.messages.send.handler(async function* ({ input, context, errors }) {
      const events = context.sendMessage({ ...input, userId: context.userId })
      for await (const event of events) {
        if (event.type !== 'error') {
          yield event
          continue
        }
        // ユースケースのエラーを contract のエラーへ変換する表。全種類を列挙し、
        // 新しいエラーを足して変換し忘れると default の satisfies never が typecheck で止める
        const { error } = event
        switch (error.type) {
          case 'conversation_not_found':
            throw errors.CONVERSATION_NOT_FOUND()
          case 'message_in_progress':
            throw errors.MESSAGE_IN_PROGRESS()
          case 'llm_unavailable':
            throw errors.LLM_UNAVAILABLE({ cause: error })
          case 'duplicate_reply':
          case 'model_price_not_found':
            throw new ORPCError('INTERNAL_SERVER_ERROR', { cause: error })
          default:
            throw new Error(`未対応のエラー: ${JSON.stringify(error satisfies never)}`)
        }
      }
    }),
  },
})
