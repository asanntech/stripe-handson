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
