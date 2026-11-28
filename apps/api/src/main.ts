import { serve } from '@hono/node-server'
import { requireEnv } from './config'
import { createDb } from './infrastructure/db/client'
import { createConversationRepository } from './infrastructure/db/conversation-repository'
import { createDatabaseHealthCheck } from './infrastructure/db/health-check'
import { createMessageRepository } from './infrastructure/db/message-repository'
import { createModelPriceRepository } from './infrastructure/db/model-price-repository'
import { createUserRepository } from './infrastructure/db/user-repository'
import { FakeLlmClient } from './infrastructure/llm/fake-llm-client'
import { createHonoApp } from './interfaces/hono/app'
import { authenticate } from './usecases/authenticate'
import { createConversation } from './usecases/create-conversation'
import { sendMessage } from './usecases/send-message'

// コンポジションルート: 依存を組み立ててサーバーを起動するだけ（ロジックは置かない）
const db = createDb({ connectionString: requireEnv('DATABASE_URL') })
const users = createUserRepository(db)
const conversations = createConversationRepository(db)
const messages = createMessageRepository(db)
const modelPrices = createModelPriceRepository(db)
// 実 LLM には接続しない（plan.md）。開発時はストリーミングが目で追える速さで 30 トークン返す
const llm = new FakeLlmClient(() => ({ inputTokens: 10, outputTokens: 30, chunkDelayMs: 50 }))

// ユースケースごとに、使うリポジトリだけを束ねて渡す（ここがユースケースの依存の一覧）
const app = createHonoApp({
  checkDatabase: createDatabaseHealthCheck(db),
  authenticate: (input) => authenticate({ users }, input),
  createConversation: (input) => createConversation({ conversations }, input),
  sendMessage: (input) => sendMessage({ conversations, messages, modelPrices, llm }, input),
})
const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})
