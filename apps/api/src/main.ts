import { serve } from '@hono/node-server'
import { createAppDeps } from './composition'
import { requireEnv } from './config'
import { createDb } from './infrastructure/db/client'
import { createApp } from './interfaces/app'

// コンポジションルート: 依存を組み立ててサーバーを起動するだけ（ロジックは置かない）
const db = createDb({ connectionString: requireEnv('DATABASE_URL') })
const app = createApp(createAppDeps({ db }))
const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})
