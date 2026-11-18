import type { Db } from '@/infrastructure/db/client'
import { createConversationRepository } from '@/infrastructure/db/conversation-repository'
import { createDatabaseHealthCheck } from '@/infrastructure/db/health-check'
import type { RpcContext } from '@/interfaces/orpc/setup'

// テスト用の oRPC Initial Context の組み立て（本番は main.ts）。RpcContext の項目は必須なので、依存を足すと両方が型エラーで知らせる
export const createTestRpcContext = ({ db }: { db: Db }): RpcContext => ({
  checkDatabase: createDatabaseHealthCheck(db),
  conversations: createConversationRepository(db),
})
