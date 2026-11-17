import { RPCHandler } from '@orpc/server/fetch'
import { Hono } from 'hono'
import { router } from './orpc/router'
import type { RpcContext } from './orpc/setup'

export const createApp = (deps: RpcContext) => {
  const rpcHandler = new RPCHandler(router)
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
