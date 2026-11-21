import { mapEventIterator } from '@orpc/client'
import { ORPCError } from '@orpc/server'

// 5xx（サーバー側の障害）と想定外の例外だけを、procedure 名付きでサーバー側のログに出す。4xx はクライアント起因なので出さない。
// logger を導入するときは、ここだけを差し替える（.claude/rules/error-logging.md）
export const logServerError = (error: unknown, path: readonly string[]) => {
  const status = error instanceof ORPCError ? error.status : 500
  if (status >= 500) console.error(`[${path.join('.')}]`, error)
}

const isAsyncIterator = (value: unknown): value is AsyncIterator<unknown> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value

// RPCHandler の clientInterceptors に登録する。ハンドラーが値を返すまでの例外に加え、
// イベントイテレータ（ストリーミング）を返す procedure では、返したあとにストリームの中で起きた例外も拾う
export const logServerErrorInterceptor = async ({
  next,
  path,
}: {
  next: () => Promise<unknown>
  path: readonly string[]
}): Promise<unknown> => {
  try {
    const output = await next()
    if (!isAsyncIterator(output)) return output
    return mapEventIterator(output, {
      value: async (value) => value,
      error: async (error) => {
        logServerError(error, path)
        return error
      },
    })
  } catch (error) {
    logServerError(error, path)
    throw error
  }
}
