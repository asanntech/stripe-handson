import { err, ok, type Result } from '@/domain/result'
import type { UserRepository } from '@/usecases/ports/user-repository'

// user_not_found: 指定された ID のユーザーが存在しない（呼び出し側で 401 にする）
export type AuthenticateError = { type: 'user_not_found' }

type Deps = {
  users: UserRepository
}

// 簡易認証（plan.md: 認証はスコープ外）: 指定された ID のユーザーが実在すれば、そのユーザーとして認証する
// ID の形式の検証（ヘッダーの解釈）は呼び出し側（oRPC の middleware）で行う
export const authenticate = async (
  deps: Deps,
  input: { userId: string },
): Promise<Result<{ userId: string }, AuthenticateError>> => {
  if (!(await deps.users.exists(input.userId))) return err({ type: 'user_not_found' })
  return ok({ userId: input.userId })
}
