// 想定外の DB エラー（接続断など）は例外のまま投げる（plan.md「エラーハンドリング方針」）
export interface UserRepository {
  exists(userId: string): Promise<boolean>
}
