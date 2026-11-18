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

- **ログは `apps/api/src/interfaces/app.ts` の `logServerError` 1 か所で出す。** oRPC の `RPCHandler` に `clientInterceptors: [onError(logServerError)]` として登録している
  - `ORPCError` は `status` が 500 以上のときだけ出す。`ORPCError` 以外の例外（バグ）は 500 とみなして出す
  - `interceptors` ではなく `clientInterceptors` に登録する。`interceptors` はリクエストの解析エラー（壊れた JSON の `SyntaxError` など、oRPC が 400 にするもの）まで生の例外のまま拾い、5xx と誤判定するため
- Hono の素のルート（第 6 章の Stripe Webhook など）を追加するときも、5xx のログは同じ `logServerError` を通す

## 未対応（第 1 章で対応する）

- **ストリーミング中のエラーはログに出ない。** `onError` はハンドラーが値を返すまでの例外しか拾わない。イベントイテレータでストリームを返す procedure では、返した後に起きた例外が届かない（クライアントには 500 が届くが、ログには残らない）。第 1 章で LLM のストリーミングを作るときに、再現テストを書いてから `mapEventIterator` などでストリームも包む
- **ログに procedure 名（`path`）が出ない。** 上の対応でインターセプターを書き直すときに、どこで起きたかが分かるよう `path` を含める

## テスト

- 5xx を返す経路では、`vi.spyOn(console, 'error')` で原因付きのエラーがログに出ることを確かめる
- 4xx を返す経路では、ログに出ないことを確かめる
