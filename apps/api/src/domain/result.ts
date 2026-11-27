// 想定内の失敗を throw せず値で返すための型（plan.md「エラーハンドリング方針」）。
// 呼び出し側は ok で分岐し、エラーの種類は判別可能なユニオン（type フィールド）で分岐する
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
