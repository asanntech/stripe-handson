import { ORPCError } from '@orpc/server'

// 5xx（サーバー側の障害）と想定外の例外だけをサーバー側のログに出す。4xx はクライアント起因なので出さない。
// logger を導入するときは、ここだけを差し替える（.claude/rules/error-logging.md）
export const logServerError = (error: unknown) => {
  const status = error instanceof ORPCError ? error.status : 500
  if (status >= 500) console.error(error)
}
