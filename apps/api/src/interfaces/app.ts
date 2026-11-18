import { ORPCError, onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { Hono } from 'hono'
import { router } from './orpc/router'
import type { RpcContext } from './orpc/setup'

// 5xx（サーバー側の障害）と想定外の例外だけをサーバー側のログに出す。4xx はクライアント起因なので出さない。
// logger を導入するときは、ここだけを差し替える（.claude/rules/error-logging.md）
export const logServerError = (error: unknown) => {
  const status = error instanceof ORPCError ? error.status : 500
  if (status >= 500) console.error(error)
}

export const createApp = (deps: RpcContext) => {
  // clientInterceptors は procedure の実行だけを包む（interceptors だとリクエストの解析エラーまで拾い、4xx を 5xx と誤判定する）
  const rpcHandler = new RPCHandler(router, { clientInterceptors: [onError(logServerError)] })
  const app = new Hono()

  app.use('/api/*', async (c, next) => {
    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      prefix: '/api',
      context: deps,
    })
    if (matched) return c.newResponse(response.body, response)
    await next()
  })

  return app
}
