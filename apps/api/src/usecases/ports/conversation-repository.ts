// 想定外の DB エラー（接続断など）は例外のまま投げる（plan.md「エラーハンドリング方針」）
export interface ConversationRepository {
  create(userId: string): Promise<{ id: string }>
  // 会話が存在し、かつそのユーザーのものか
  isOwnedBy(key: { conversationId: string; userId: string }): Promise<boolean>
}
