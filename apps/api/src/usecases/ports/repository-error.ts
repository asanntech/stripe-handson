// リポジトリ共通のインフラエラー（retryable / fatal の区別は、リトライが必要になる第 3〜4 章で足す）
export type RepositoryError = { type: 'database_error'; cause: unknown }
