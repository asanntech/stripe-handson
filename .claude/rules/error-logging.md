---
paths:
  - "apps/api/src/**"
---

# エラーのログ

logger を導入するまでは `console.error` を使う。ログを出す場所は 1 か所に集め、logger を導入するときはそこだけを差し替える。

## 規則

- **5xx（サーバー側の障害）は、原因をサーバー側のログに必ず残す。** クライアントには原因を返さない（レスポンスに `cause` は含まれない）
- **4xx（クライアント起因）はログに出さない。** 残高不足・冪等キーの不一致・壊れたリクエストなどは想定どおりの動作で、ログに出すとノイズになる
- **ハンドラーは原因を `cause` に持たせて投げるだけにし、`console.error` を直接呼ばない。**

  ```ts
  if (result.isErr()) throw errors.SERVICE_UNAVAILABLE({ cause: result.error })
  ```

- **ログは `apps/api/src/interfaces/orpc/log-server-error.ts` の `logServerError` 1 か所で出す。** 形式は `console.error('[procedure 名]', error)`（例: `[messages.send]`）
  - `ORPCError` は `status` が 500 以上のときだけ出す。`ORPCError` 以外の例外（バグ）は 500 とみなして出す
  - 同じファイルの `logServerErrorInterceptor` を、`apps/api/src/interfaces/hono/app.ts` で oRPC の `RPCHandler` の `clientInterceptors` に登録している。ハンドラーが値を返すまでの例外に加え、イベントイテレータ（ストリーミング）を返す procedure では `mapEventIterator` でストリームを包み、返したあとに起きた例外も拾う
  - `interceptors` ではなく `clientInterceptors` に登録する。`interceptors` はリクエストの解析エラー（壊れた JSON の `SyntaxError` など、oRPC が 400 にするもの）まで生の例外のまま拾い、5xx と誤判定するため
- Hono の素のルート（第 6 章の Stripe Webhook など）を追加するときも、5xx のログは同じ `logServerError` を通す（そのときに `ORPCError` 以外のエラーにも対応させ、`orpc/` の外へ置き場所を見直す）

## 未対応

- **クライアントが切断したあとのバックグラウンド生成で起きた例外はログに出ない。** 送信は切断後も生成を続ける（`usecases/run-detached.ts`）が、購読者がいないので例外の届け先がなく、インターセプターまで届かない（送信は `finally` で「失敗」になる）。ログのポート（logger）を導入するときに、ユースケースから出せるようにする
- **送信を「失敗」にする更新（`markFailed`）自体が失敗したときもログに出ない。** 理由と対応時期は上と同じ

## テスト

- 5xx を返す経路では、`vi.spyOn(console, 'error')` で原因付きのエラーがログに出ることを確かめる
- 4xx を返す経路では、ログに出ないことを確かめる
