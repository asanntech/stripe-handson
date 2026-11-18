import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { Hono } from 'hono'
import { logServerError } from '@/interfaces/orpc/log-server-error'
import { router } from '@/interfaces/orpc/router'
import type { RpcContext } from '@/interfaces/orpc/setup'

// HTTP の入口: Hono のアプリを組み立て、/api/* を oRPC に振り分ける（サーバーの起動は main.ts）
export const createHonoApp = (context: RpcContext) => {
  // clientInterceptors は procedure の実行だけを包む（interceptors だとリクエストの解析エラーまで拾い、4xx を 5xx と誤判定する）
  const rpcHandler = new RPCHandler(router, { clientInterceptors: [onError(logServerError)] })
  const app = new Hono()

  app.use('/api/*', async (c, next) => {
    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      prefix: '/api',
      context: { ...context, userId: c.req.header('x-user-id') },
    })
    if (matched) return c.newResponse(response.body, response)
    await next()
  })

  return app
}
