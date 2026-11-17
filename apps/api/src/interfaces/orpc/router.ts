import { orpc } from './setup'

export const router = orpc.router({
  health: {
    check: orpc.health.check.handler(async ({ context, errors }) => {
      const result = await context.checkDatabase()
      // ドメイン / インフラのエラーは、ここで contract に定義した型付きエラーへ変換する
      if (result.isErr()) throw errors.SERVICE_UNAVAILABLE()
      return { status: 'ok', database: 'ok' }
    }),
  },
})
