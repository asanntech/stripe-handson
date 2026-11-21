---
paths:
  - "apps/api/src/interfaces/**"
---

# ミドルウェアの置き場所（Hono か oRPC か）

**HTTP というやり取りの性質に関わるもの（全ルート共通）は Hono、procedure を実行する前提条件（誰が・何に対して）は oRPC に置く。**

## 規則

- **Hono のミドルウェア（`interfaces/hono/`）**: oRPC 以外の素のルート（第 6 章の Stripe Webhook など）にも効いてほしいもの
  - 例: CORS、セキュリティヘッダー、リクエスト ID、アクセスログ、ボディサイズの上限、圧縮、IP 単位のレート制限
- **oRPC のミドルウェア（`interfaces/orpc/`）**: procedure ごとに付け外しするもの、型付きの値を Execution Context に足すもの、contract の型付きエラーで返したいもの
  - 例: 認証（`authedOrpc`）・認可、ユーザー単位のレート制限、procedure ごとのタイムアウト
  - 認証が要らない procedure（ヘルスチェックなど）は `orpc`、要る procedure は `authedOrpc` から作る
  - `orpc` / `authedOrpc` のような procedure ビルダーは `interfaces/orpc/setup.ts` に並べる。ミドルウェアの中身が大きくなったら、関数だけを別ファイルに出し、`setup.ts` には `orpc.use(...)` の組み立てを残す
- **Hono から oRPC へ値を渡すのは Initial Context（`hono/app.ts` の `rpcHandler.handle(..., { context })`）だけにする。** 渡すのはリクエスト由来の生の値（`headers` など）までにし、検証や解釈は oRPC のミドルウェアで行う
  - Hono の `c.set()` は oRPC から見えない。Initial Context で「あるかもしれない値」として渡すと、ハンドラーで毎回 null チェックが要り、型の保証が弱くなる

## 迷ったとき

次の 2 点で決める。

1. oRPC 以外のルート（Webhook など）にも効いてほしいか → はいなら Hono
2. `userId` など、検証済みの値を型付きでハンドラーに渡したいか → はいなら oRPC

両方に当てはまる（または判断がつかない）ときは、実装する前にユーザーに相談する。

## 関連

- エラーのログの置き場所は `.claude/rules/error-logging.md`（5xx の原因と procedure 名は oRPC のインターセプターで出す）
