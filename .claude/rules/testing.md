---
paths:
  - "apps/api/**/*.test.ts"
  - "apps/api/test/**"
---

# テストの書き方

方針（ユースケース層を実 DB で一番厚くする理由）は `docs/plan.md`「テスト方針」。

## 層ごとの役割

| 層 | 検証すること | 依存 | 厚さ |
|---|---|---|---|
| domain | 純粋な計算（引き当て・超過判定・クレジット換算など） | なし | 厚く |
| usecases | 業務の流れの分岐・競合・Tx 境界。ユースケースを直接呼ぶ | 実リポジトリ＋実 PostgreSQL＋Fake LLM | **一番厚く** |
| infrastructure | DB 固有の変換（制約違反 → ドメインエラー）・制約そのもの・ロックの振る舞い | 実 PostgreSQL | 必要な分だけ |
| interfaces | 認証・入力の検証・ユースケースのエラー → contract のエラーの変換・ストリーミングの形・5xx のログ | API 経由（実 DB） | 薄く |

## 規則

- **新しい機能は、ユースケースのテストから書き始める。** API のテストは、エラーの変換と認証を確かめる分だけ足す。業務の分岐を API のテストで網羅しない
- **リポジトリのインメモリ Fake は作らない。** Fake にするのは外部 API（`FakeLlmClient`・Stripe）だけ
  - 検証したいのは制約・ロック・Tx といった DB の振る舞いで、Fake では再現できず、本物とずれても気づけないため
- **ユースケースのテストでは、依存を引数で直接渡す。** リポジトリは `createXRepository(db)` の本物を使う
  - 例: `sendMessage({ conversations, messages, modelPrices, llm }, input)`
- **DB を使うテストは `beforeEach` で `truncateAllTables(db)` を明示的に呼ぶ**
- **競合テストは `createBarrier()` と `waitUntilWaitingForLock()` で実行順序を固定する。** 確率的に Green になるテストは書かない
- 5xx / 4xx のログの確かめ方は `.claude/rules/error-logging.md`「テスト」

## 置き場所

- テストは対象の実装ファイルと同じ階層に `xxx.test.ts` で置く（コロケーション。例: `src/domain/credit.ts` ↔ `src/domain/credit.test.ts`）
- API 経由の結合テストは `src/interfaces/orpc/` に機能名で置く（例: `messages.test.ts`）
- 対応する実装ファイルがないテスト（行ロック・テーブルの制約など DB の振る舞い）は、対象に最も近いディレクトリに置く（例: `src/infrastructure/db/row-lock.test.ts`）
- 対応する実装がない共通のヘルパー・グローバルセットアップだけ `apps/api/test/` に置き、`@test/` で import する（ヘルパー自身のテストはヘルパーの隣）
