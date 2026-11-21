# stripe-handson

ハンズオン計画は `docs/plan.md` を参照。

## コマンド

```sh
pnpm db:up        # PostgreSQL（host port 5436、開発用 app / テスト用 app_test）を起動
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
| `main.ts` | コンポジションルート（依存の組み立てのみ） |

- 依存は外側 → 内側のみ（interfaces / infrastructure → usecases → domain）
- domain 層で使ってよいライブラリは純粋なものの許可リストだけ: `neverthrow`、`ts-pattern`。リストに足すときはユーザーに相談する（Drizzle・pg・Stripe・Hono・oRPC などは不可）
- ライブラリのセットアップは、それを使う層の中の `setup.ts` に置く（トップレベルの `libs/` は作らない）
- API の仕様（input / output）は `packages/contract` に定義し、サーバーは `implement(contract)` で実装する
- DB アクセスはアプリもテストも `createDb()`（Drizzle）に統一する。プールが必要なときは `db.$client`
- import は拡張子なしで書く（`moduleResolution: bundler`）。`apps/api/src` へはエイリアス `@/`（例: `@/usecases/ports/llm-client`）、同じディレクトリ内は `./`。親ディレクトリへの `../` はテストのヘルパー（`helpers/`）以外禁止（Biome の `noRestrictedImports` で強制）
- `packages/*` ではエイリアスを使わない（api がソースのまま読み込むため、api 側の設定で解決されて壊れる）

## テストの規約

- DB を使うテストは `beforeEach` で `truncateAllTables(db)` を明示的に呼ぶ
- 競合テストは `createBarrier()` と `waitUntilWaitingForLock()` で実行順序を固定する（確率的に Green になるテストは書かない）
