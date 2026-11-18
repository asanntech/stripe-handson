import { type ContractRouterClient, oc } from '@orpc/contract'
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
}

export type AppContract = typeof contract
export type AppClient = ContractRouterClient<AppContract>
