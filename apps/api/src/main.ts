import { serve } from '@hono/node-server'
import { requireEnv } from './config'
import { createDb } from './infrastructure/db/client'
import { createConversationRepository } from './infrastructure/db/conversation-repository'
import { createDatabaseHealthCheck } from './infrastructure/db/health-check'
import { createMessageRepository } from './infrastructure/db/message-repository'
import { createUserRepository } from './infrastructure/db/user-repository'
import { FakeLlmClient } from './infrastructure/llm/fake-llm-client'
import { createHonoApp } from './interfaces/hono/app'

// コンポジションルート: 依存を組み立ててサーバーを起動するだけ（ロジックは置かない）
const db = createDb({ connectionString: requireEnv('DATABASE_URL') })
const app = createHonoApp({
  checkDatabase: createDatabaseHealthCheck(db),
  users: createUserRepository(db),
  conversations: createConversationRepository(db),
  messages: createMessageRepository(db),
  // 実 LLM には接続しない（plan.md）。開発時はストリーミングが目で追える速さで 30 トークン返す
  llm: new FakeLlmClient(() => ({ inputTokens: 10, outputTokens: 30, chunkDelayMs: 50 })),
})
const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})
