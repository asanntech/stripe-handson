import type { Result } from '@/domain/result'

// テストの準備や検証で成功の値を取り出す。Err のときはエラーを cause に付けて落とす
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) throw new Error('Ok を期待しましたが Err でした', { cause: result.error })
  return result.value
}
