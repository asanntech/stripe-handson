import type { Db } from '@/infrastructure/db/client'
import { createConversationRepository } from '@/infrastructure/db/conversation-repository'
import { createDatabaseHealthCheck } from '@/infrastructure/db/health-check'
import { createMessageRepository } from '@/infrastructure/db/message-repository'
import { createModelPriceRepository } from '@/infrastructure/db/model-price-repository'
import { createUserRepository } from '@/infrastructure/db/user-repository'
import { FakeLlmClient } from '@/infrastructure/llm/fake-llm-client'
import type { RpcContext } from '@/interfaces/orpc/setup'
import type { LlmClient } from '@/usecases/ports/llm-client'

// テスト用の oRPC Initial Context の組み立て（本番は main.ts）。RpcContext の項目は必須なので、依存を足すと両方が型エラーで知らせる
// llm を省略したときは、1 トークンだけ返す Fake を使う（LLM を使わないテスト向け）
export const createTestRpcContext = ({
  db,
  llm = new FakeLlmClient(() => ({ inputTokens: 1, outputTokens: 1 })),
}: {
  db: Db
  llm?: LlmClient
}): RpcContext => ({
  checkDatabase: createDatabaseHealthCheck(db),
  users: createUserRepository(db),
  conversations: createConversationRepository(db),
  messages: createMessageRepository(db),
  modelPrices: createModelPriceRepository(db),
  llm,
})
