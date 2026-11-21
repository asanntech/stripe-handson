import { type ContractRouterClient, eventIterator, oc } from '@orpc/contract'
import { z } from 'zod'

// API の仕様（input / output / ルート）。サーバーはこれを implement し、クライアントはこれだけに依存する
export const contract = {
  health: {
    check: oc
      .errors({
        SERVICE_UNAVAILABLE: { status: 503, message: 'Database is unavailable' },
      })
      .output(
        z.object({
          status: z.literal('ok'),
          database: z.literal('ok'),
        }),
      ),
  },
  conversations: {
    create: oc.output(z.object({ conversationId: z.uuid() })),
  },
  messages: {
    // 応答はイベントイテレータでストリームする（delta を 0 回以上 → 最後に done）
    send: oc
      .errors({
        CONVERSATION_NOT_FOUND: { status: 404, message: 'Conversation not found' },
        LLM_UNAVAILABLE: { status: 502, message: 'The LLM stream was interrupted' },
        MESSAGE_IN_PROGRESS: {
          status: 409,
          message: 'A message with the same clientMessageId is still being generated',
        },
      })
      .input(
        z.object({
          conversationId: z.uuid(),
          clientMessageId: z.uuid(),
          content: z.string().min(1),
        }),
      )
      .output(
        eventIterator(
          z.discriminatedUnion('type', [
            z.object({ type: z.literal('delta'), text: z.string() }),
            z.object({ type: z.literal('done'), messageId: z.uuid() }),
          ]),
        ),
      ),
  },
}

export type AppContract = typeof contract
export type AppClient = ContractRouterClient<AppContract>
