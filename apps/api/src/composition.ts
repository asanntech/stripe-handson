import type { Db } from './infrastructure/db/client'
import { createConversationRepository } from './infrastructure/db/conversation-repository'
import { createDatabaseHealthCheck } from './infrastructure/db/health-check'
import type { RpcDeps } from './interfaces/orpc/setup'

// 本番の依存の組み立て。main.ts（コンポジションルート）とテストで同じ組み立てを使う
export const createAppDeps = ({ db }: { db: Db }): RpcDeps => ({
  checkDatabase: createDatabaseHealthCheck(db),
  conversations: createConversationRepository(db),
})
