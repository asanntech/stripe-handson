// 必須の環境変数を読む。未設定・空文字なら起動時にエラーで止める
// （例: DATABASE_URL が無いと pg は黙って localhost:5432 に接続してしまうため）
export const requireEnv = (
  name: string,
  env: Record<string, string | undefined> = process.env,
): string => {
  const value = env[name]
  if (!value) throw new Error(`環境変数 ${name} が設定されていません（.env.example を参照）`)
  return value
}
