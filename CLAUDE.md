# stripe-handson

ハンズオン計画は `docs/plan.md` を参照。

## コマンド

```sh
pnpm db:up        # PostgreSQL（host port 5436、開発用 app / テスト用 app_test）を起動
pnpm db:migrate   # 開発用 DB（app）にマイグレーションを適用（テスト用 DB はテスト実行時に自動適用）
pnpm db:seed      # 開発用 DB に初期データ（fake-model の単価）を投入（何度実行しても同じ）
pnpm test         # 全テスト（実 PostgreSQL が必要。TDD の各遷移ではこれを使う）
pnpm lint         # Biome（format + lint）チェック
pnpm format       # Biome の自動修正
pnpm typecheck    # tsc --noEmit
```

- 接続先は `.env`（`.env.example` をコピー）。テストは `TEST_DATABASE_URL`（未設定時は `localhost:5436/app_test`）。
- `docs/` などの Markdown は Biome の対象外。

## アーキテクチャ（apps/api/src）

クリーンアーキテクチャ。方針の詳細は `docs/plan.md` の「アーキテクチャ方針」を参照。

| ディレクトリ | 役割 |
|---|---|
| `domain/` | 業務ルール（純粋な計算）。他の層と、I/O・副作用・フレームワークに依存するライブラリに依存しない |
| `usecases/` | ユースケース。Tx 境界を持つ。外部依存は `usecases/ports/` のインターフェース経由 |
| `infrastructure/` | ポートの実装（Drizzle・Stripe・Fake LLM など） |
| `interfaces/` | 入口。oRPC の procedure（`interfaces/orpc/`）、Hono のアプリと素のルート（`interfaces/hono/`） |
| `server.ts` | HTTP サーバーのエントリーポイント兼コンポジションルート（依存の組み立てと起動のみ） |

- 依存は外側 → 内側のみ（interfaces / infrastructure → usecases → domain）
- domain 層は外部ライブラリに依存しない（許可リストは空。隣に置くテストファイルの vitest は対象外）。足したくなったらユーザーに相談する（Drizzle・pg・Stripe・Hono・oRPC などは不可）
- 想定内のエラー（業務上の意味があるもの）だけ throw せず `Result`（`@/domain/result`）で返す。想定外のエラー（DB の接続断など）は例外のまま投げる。neverthrow / ts-pattern は使わない（`docs/plan.md`「エラーハンドリング方針」）
- ライブラリのセットアップは、それを使う層の中の `setup.ts` に置く（トップレベルの `libs/` は作らない）
- API の仕様（input / output）は `packages/contract` に定義し、サーバーは `implement(contract)` で実装する
- DB アクセスはアプリもテストも `createDb()`（Drizzle）に統一する。プールが必要なときは `db.$client`
- import は拡張子なしで書く（`moduleResolution: bundler`）。`apps/api/src` へはエイリアス `@/`（例: `@/usecases/ports/llm-client`）、`apps/api/test`（テストのヘルパー）へは `@test/`（例: `@test/helpers/database`）、同じディレクトリ内は `./`。親ディレクトリへの `../` は禁止（Biome の `noRestrictedImports` で強制）
- `packages/*` ではエイリアスを使わない（api がソースのまま読み込むため、api 側の設定で解決されて壊れる）

## テストの規約

- テストの書き方（層ごとの役割・置き場所・TRUNCATE・競合テスト）は `.claude/rules/testing.md` を参照
