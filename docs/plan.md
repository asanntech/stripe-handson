# ハンズオン計画: AIチャット × クレジット課金で学ぶ DB 設計と冪等性

## 目的

バックエンドの **トランザクション / ロック（悲観・楽観・デッドロック）/ インデックス / 制約 / 冪等性** を、
Stripe と連携した「トークン消費型 AI チャット」を題材に網羅的に学ぶ。自分自身の学習用。

- 残高の正本を **自前 DB** に置く（Stripe は決済のみ）。DB が「Stripe の写し」にならないようにするため。
- **正本の責務分担**: お金（決済・返金・請求）の正本は **Stripe**（`purchases` はその写し）、クレジット（利用権）の正本は **自前 DB**。同じ数値を二重に持たないため二重管理にはしない。
  送信ごとのリアルタイム判定（残高 0 で拒否・max_tokens 算出）が必要なため、Stripe Billing の Credit Grants / Meters（非同期集計・請求時相殺）には寄せない。
- 競合は「素朴な実装 → 競合を再現 → 修正 → 検証」の順で体験する。

## 技術スタック

| 領域 | 採用 | 備考 |
|---|---|---|
| 言語 / FW | TypeScript + Hono | |
| API | oRPC（Hono 上） | Stripe Webhook のみ Hono 生ルート（署名検証に raw body が必要） |
| ストリーミング | oRPC イベントイテレータ（async generator） | |
| DB | PostgreSQL | Docker。`auto_explain`・`log_lock_waits` 有効 |
| DB アクセス | Drizzle ORM / drizzle-kit | `.for('update', { skipLocked })`・`onConflictDoUpdate`・部分インデックス・CHECK をスキーマで表現 |
| アーキテクチャ | クリーンアーキテクチャ | 後述「アーキテクチャ方針」 |
| テスト | Vitest + 実 PostgreSQL | 後述「テスト方針」 |
| フロント | Vite + React（最小限 UI、完成品として用意） | チャット / 残高・付与の内訳 / 購入 / 利用履歴 |
| LLM | 自作 `FakeLlmClient` のみ（`LlmClient` ポートの実装） | 出力トークン数・チャンク間遅延・切断位置・max_tokens 打ち切りをリクエスト単位で指定、usage を返す。実 LLM には接続しない |
| 認証 | `X-User-Id` ヘッダーの簡易認証 | スコープ外 |
| Lint / Format | Biome 単体 | 後述「リント方針」 |
| エラーハンドリング | 想定内のエラーだけ自前の `Result` 型（`domain/result.ts`）、想定外は例外 | 後述「エラーハンドリング方針」 |
| 開発手法 | `/tdd` スキル（AI が実装、ユーザーはサイクル境界でレビュー） | |

## ドメインとビジネスルール

### クレジットモデル（個人の月次付与 ＋ プリペイド）

- 残高の単位は **クレジット**（整数）。トークンはモデル別・入出力別の **単価表** で換算する。
  - 単価表は履歴管理（適用開始日時）。送信時点の単価を利用記録に固定する。
  - 入出力トークン数は利用履歴として別途記録する。
- 各ユーザーに **毎月 100 クレジットを無償付与**（JST 暦月、月末失効）。
- 使い切ったら **個人でプリペイド購入**（Stripe Checkout、**有効期限なし**）。
- 有償 / 無償は台帳上で区別する（前払式支払手段を意識）。
- **消費順**: 失効が早いもの（無償付与）→ 購入分（古い順）。並び: `expires_at NULLS LAST, created_at, id`
- 消費時は失効バッチの実行有無に関わらず **必ず `expires_at > now()` で絞る**。

### 課金タイミングと超過（マイナス）ポリシー

- **仮押さえ（hold）なし**。送信前に残高チェック → 応答完了後に実消費量を引く。
- 送信前チェック: `残高 > 0` でなければ拒否。
- 送信時に `残高 + 超過上限` から **max_tokens** を算出し、単独送信では上限を超えないようにする。
- それでも同時送信の合算で超えた分は、上限まで引き、**不足分を台帳に「切り捨て（write-off）」として記録**。
- `wallets.balance >= -上限` を **CHECK 制約** で最後の砦として強制。
- 残高がマイナス（未精算）の間は新規送信を拒否。次回の付与・購入時に未精算分から相殺する。

### 月次付与と失効

- **遅延付与**: その月の初回の送信 / 残高参照時、財布行ロック内で「今月分が未付与なら付与」。
  `(user_id, 対象月)` ユニーク制約で二重付与を防ぐ。
- **失効**: 定期バッチ。部分インデックスで「期限切れかつ残量あり」の付与行を抽出し、分割処理。

## データモデル（概要）

| テーブル | 役割 | 主な制約 / インデックス |
|---|---|---|
| `users` | ユーザー | |
| `conversations` | 会話 | |
| `user_messages` | ユーザーの送信（本文・状態: 生成中 / 完了 / 失敗） | `UNIQUE (conversation_id, client_message_id)`、カーソルページング用複合 index |
| `assistant_messages` | LLM の応答（完了時のみ作成） | `UNIQUE (user_message_id)`（送信 1 回に応答 1 つ） |
| `model_prices` | 単価表（履歴） | `(model, effective_from)` |
| `usage_records` | 利用履歴（入出力トークン・適用単価・消費クレジット） | `UNIQUE (message_id)`（二重課金防止） |
| `wallets` | ユーザーごと 1 行。残高キャッシュ・未精算額・version | **ロックの起点**。`CHECK (balance >= -limit)` |
| `credit_grants` | クレジット付与（付与額・残量・有効期限・有償/無償・`source`: `monthly_free` / `purchase`） | 消費順 index、失効対象の部分 index、`UNIQUE (purchase_id)`、`UNIQUE (user_id, grant_month)` |
| `ledger_entries` | 追記のみの台帳（付与・購入・消費・失効・返金・切り捨て・相殺） | |
| `purchases` | 購入（未決済 → 支払済み → 返金…） | `UNIQUE (user_id, idempotency_key)`、`UNIQUE (checkout_session_id)` |
| `stripe_events` | Webhook 受信箱 | `UNIQUE (event_id)`、未処理取得用の部分 index |
| `outbox` | 外部 API 呼び出し依頼（返金など） | 未処理取得用の部分 index |

不変条件: **`wallets.balance` = 有効な付与の残量合計 − 未精算額 = 台帳合計**（第 10 章で検証）。

## 主要フロー

### 消費（チャット送信）

1. `client_message_id` で受付（重複なら：生成済み → 既存応答を返す / 生成中 → 409）。
2. Tx: 財布行 `FOR UPDATE` → 遅延付与 → 残高チェック → max_tokens 算出。
3. Fake LLM でストリーミング（**Tx の外**）。
4. Tx: 財布行 `FOR UPDATE` → 付与行を消費順に引き当て（ドメイン層で計算）→ 台帳・利用履歴を記録（`UNIQUE (message_id)`）。

### 購入

1. クライアントが `Idempotency-Key` ヘッダー付きで購入 API を呼ぶ → `purchases` を「未決済」で作成。
2. `purchase.id` を Stripe 側の Idempotency-Key にして Checkout Session を作成（**DB Tx の外**）。
3. Webhook `checkout.session.completed` → 受信箱 → ワーカーが「支払済み」へ遷移しクレジット付与を作成（`UNIQUE (purchase_id)`）、未精算分を相殺。

### Webhook 受信箱

- 受信: 署名検証 → `stripe_events` に INSERT（`event_id` 重複は無視）→ 即 200。
- ワーカー: `FOR UPDATE SKIP LOCKED` で未処理を取得 → 業務処理と「処理済み」更新を同一 Tx。
- リトライ回数上限超過で処理不能として隔離。

### 返金

- **アプリ発**: 未使用分のみ。財布行・付与行をロックして残量を減らし、同一 Tx で `outbox` に返金依頼 →
  ワーカーが冪等キー付きで Stripe Refund API を呼ぶ。
- **ダッシュボード発**: `charge.refunded` を受けて残量を減らし、足りない分は未精算として扱う。

## アーキテクチャ方針（クリーンアーキテクチャ）

- **ユースケースがトランザクション境界を持つ**: `TransactionManager` ポート（`tx.run(async (repos) => ...)`）。
- **ロックはリポジトリのメソッド名で明示**: 例 `walletRepository.findByUserIdForUpdate()`。
- 付与行への引き当て計算・超過判定などの業務ルールは **ドメイン層**。
- DB 制約は最後の砦として併用し、制約違反はリポジトリでドメインエラーに変換する。
- Stripe / LLM はポート（`PaymentGateway` / `LlmClient`）。**外部 API 呼び出しを DB Tx の中で行わない**。

## エラーハンドリング方針（想定内のエラーだけ Result・想定外は例外）

- **想定内のエラー（業務上の意味があり、呼び出し側が種類ごとに扱いを変えるもの）だけ `Result` で返す。**
  `Result<T, E>` は `{ ok: true; value } | { ok: false; error }` の判別可能なユニオンで、`domain/result.ts` に置く（ライブラリは使わない）。
  呼び出し側は `if (!result.ok) ...` の早期 return で分岐する。
  - 例: 残高不足 / 超過上限到達 / 重複送信 / 冪等キーの内容不一致 / 外部 API の想定内の失敗（LLM の切断など）
- **想定外のエラー（接続断・SQL のバグ・想定していない制約違反など）は Result にせず、例外のまま投げる。**
  どの呼び出し側も「上に渡して最後に 500 にする」しかできないため、Result にしても分岐が増えるだけで扱いは変わらない。
  最上位（oRPC の `logServerErrorInterceptor`）でログに出して 500 にする。ユースケースは `finally` で後始末だけを行う。
- エラー型は判別可能なユニオン（`type` フィールド）で定義する。
- **DB のエラーの線引き**（リポジトリの責務）:
  | 種類 | 例 | 扱い |
  |---|---|---|
  | 業務上の意味がある | 23505 ユニーク違反 → 重複、23514 CHECK 違反 → 超過上限到達、55P03 ロック取得不可 | 該当メソッドの中で `getPgErrorCode` で判定し、ドメインエラーの `Result` に変換する（`ON CONFLICT DO NOTHING` の 0 行で判定できるときはそれを使う） |
  | リトライ可能 | 40P01 デッドロック・40001 直列化失敗 | 例外のまま投げ、`TransactionManager` が SQLSTATE を見て回数上限付きでリトライする |
  | 想定外 | 接続断・不明な制約違反 | 例外のまま投げる（500） |
  | ヘルスチェック | `database_unavailable` | DB の停止を検出するのが目的なので `Result` で返す |
- **TransactionManager の規約（重要）**: Drizzle は「コールバックが throw したときだけ」ロールバックする。
  想定外の DB エラーは例外のままなので自然にロールバックされる。一方、ドメインの `err` を返すと途中までの書き込みがコミットされてしまうため、
  `TransactionManager.run` が **`Err` を受けたら内部の番兵例外でロールバックし、外側で `Err` に戻す**。
- ハンドラー層（oRPC）でエラーの `type` を `switch` で網羅的に分岐し（`default` の `satisfies never` で変換漏れを typecheck で止める）、ドメインエラーを oRPC の型付きエラーに変換する。
- Biome では「Result の戻り値の無視」を検出できない。
  エラー経路は必ずテストで検証する（特に「Err のときロールバックされる」ことを TransactionManager のテストで保証）。

## リント方針（Biome）

DB 関連のバグを機械的に止めることを主目的とする。

- **await 付け忘れ**: `noFloatingPromises` を有効化（Tx 内で await を忘れるとコミット後・Tx 外でクエリが走る）。
  検出率は typescript-eslint の約 75% のため、残りは Tx 境界のテストで担保する。
- **WHERE 句なし UPDATE / DELETE の禁止**: GritQL プラグインで自作ルールを書く（Drizzle の `db.update()` / `db.delete()` に `.where()` がない呼び出しを検出）。
- **層の依存方向**: `noRestrictedImports` をディレクトリ別の overrides で設定（例: `domain/` から `infrastructure/`・`drizzle-orm` の import を禁止）。

## 調査ツール（PostgreSQL 本体 ＋ 公式拡張のみ）

- 診断: `EXPLAIN (ANALYZE, BUFFERS)`（更新系は `BEGIN; ... ROLLBACK;`）
- 統計: `pg_stats` / `pg_stat_user_tables` / `pg_stat_user_indexes`
- ロック観測: `pg_stat_activity`（wait_event）/ `pg_locks` / `pg_blocking_pids()` / `log_lock_waits` / デッドロックログ
- 負荷中の実行計画: `auto_explain`
- ※ EXPLAIN ではロック待ちは見えない。可視化ツール（explain.dalibo.com 等）は任意。

## テスト方針（`/tdd` 運用規約）

- 統合テストは **実 PostgreSQL** に対して行う。テスト間は TRUNCATE で分離、Vitest のファイル並列は無効。
- **競合テストはバリアで実行順序を固定し、決定的に再現する**（確率的な「たまたま Green」を許さない）。
  test-list のシナリオは「バリアで A→B の順に固定したとき 〜 になる」と書く。
- 競合テストは複数接続（プールサイズ ≥ 2）、Tx タイムアウトはテスト用に延長。
- デッドロックテストは `deadlock_timeout` / `lock_timeout` を短く設定。
- Stripe Webhook は `stripe.webhooks.generateTestHeaderString` で署名したフィクスチャを直接送る。LLM は Fake LLM。
- 確率的な検証（同時 100 送信など）と不変条件チェックは **負荷スクリプト** で別途行う。

## 章立て

| 章 | 内容 | 主な学習ポイント |
|---|---|---|
| 0 | 環境構築 | Docker / Drizzle / Hono + oRPC / Vitest 基盤（TRUNCATE・バリア・複数接続）/ Fake LLM |
| 1 | チャット基礎 | ストリーミング、`client_message_id` ユニーク制約による二重送信防止 |
| 2 | 単価と換算 | 単価表の履歴管理、利用履歴 |
| 3 | 残高（素朴版） | クレジット付与・台帳、月次遅延付与（ユニーク制約）、read-modify-write による **Lost Update 再現** |
| 4 | ロック | 付与行の直接ロックで **デッドロック再現** → ロック順序統一 → 財布行起点の悲観ロック vs 楽観ロック（version）比較 → TOCTOU / CHECK / max_tokens / 切り捨て。分離レベルは必要箇所で触れる |
| 5 | 購入 | 自社 API の Idempotency-Key、Stripe 側の冪等キー、Checkout 作成タイムアウト時の不整合 |
| 6 | Webhook 受信箱 | `SKIP LOCKED` ワーカー、リトライ・隔離、クレジット付与の一意性、未精算相殺 |
| 7 | 返金 | Outbox パターン、Refund API の冪等性、ダッシュボード発返金 |
| 8 | 失効バッチ | 部分インデックス、分割処理、消費との競合 |
| 9 | 性能 | 大量シード、カーソル vs OFFSET、複合（列順）/ 部分 / INCLUDE、書き込みコスト、負荷中の auto_explain、ロック待ち観測 |
| 10 | 整合性 | 不変条件の検証、負荷スクリプト |
| 付録 | サブスク | Pro プラン＝月次付与の増量。`invoice.paid`、イベント順序の入れ替わり、日割り |

インデックスは各章で制約・ロックに必要なものを定義し、第 9 章で検索性能の観点からまとめて検証する。

## スコープ外

- Stripe と自前 DB の突合（リコンシリエーション）バッチ
- 認証・認可（簡易ヘッダーのみ）
- 仮押さえ（hold）方式
- 組織単位の共有残高
- ストリームの途中再開（再接続して続きから受信）
- 実 LLM（Claude API 等）への接続。Claude の Max プラン等サブスクの流用は規約上不可
- RDS / CloudWatch Database Insights、外部監視 SaaS
- 学習者による UI 実装

## 設計判断ログ

| 判断 | 採用 | 検討した代替案 | 理由 |
|---|---|---|---|
| 題材 | AI チャット × トークン課金 | 在庫販売 / サブスク SaaS / Connect / ウォレット | 実務経験を活かせる。同一行の競合・冪等性の論点が自然に揃う |
| 課金モデル | プリペイド（＋付録でサブスク） | サブスクのみ / Billing Meters 後払い | 残高の正本が自前 DB になり、ロック・台帳の学習が濃い |
| 残高単位 | クレジット（換算） | トークン数そのもの | 実サービスに近い。単価履歴の論点が増える |
| 仮押さえ | なし（超過を上限付きで許容） | 段階的に両方 / 最初から hold | AI SaaS で一般的な設計を採用 |
| 超過時 | max_tokens 制限 ＋ 切り捨て記録 | 制限なし ＋ 切り捨て / 上限無視 | 単独送信の超過を防ぎ、DB 制約も維持できる |
| 残高の所有 | 個人（月次無償付与 ＋ プリペイド） | 組織共有 ＋ メンバー上限 | 実務経験に一致。付与行をまたぐ複数行ロックでデッドロック題材も確保 |
| ロック起点 | 財布行（wallets） | 付与行の直接ロック / Advisory Lock | 付与行に残高が分散すると合計への CHECK が効かないため。直接ロック版は第 4 章の実験で扱う |
| Webhook | 受信箱 ＋ 非同期ワーカー | 同期処理 / 段階移行 | `SKIP LOCKED`・リトライ・部分インデックスまで学べる |
| 購入記録 | 先に自前の購入行を作成 | Webhook 受信後に作成 | 自社 API と Stripe API 双方の冪等キーを学べる |
| 送信の冪等性 | `client_message_id` ＋ 課金 1 回 | ストリーム再開まで / 後付け | DB 学習に集中 |
| メッセージのテーブル | 送信 `user_messages` と応答 `assistant_messages` に分割 | `messages` 1 テーブル ＋ role 列 / 1 ターン 1 行 | 役割ごとの列を NOT NULL にでき、拡張時も該当テーブルだけを触ればよい。「送信 1 回に応答 1 つ」を UNIQUE で保証できる |
| 返金 | アプリ発（Outbox）＋ ダッシュボード発 | ダッシュボード発のみ / なし | Outbox の題材 |
| 月次付与 | 遅延付与 ＋ 失効バッチ | 月初一括 / 両方 | 休眠ユーザー分を作らない。経路を一本化 |
| DB アクセス | Drizzle | Prisma / Kysely / 生 SQL | ロック句・UPSERT・部分インデックスを生 SQL なしで書ける |
| 調査ツール | PostgreSQL 本体 ＋ 公式拡張 | PgHero・pg_stat_statements 追加 / RDS | 環境非依存の知識。発見工程は対象外 |
| Tx の責務 | ユースケースが境界、ロックはメソッド名で明示 | リポジトリ隠蔽 / 軽量レイヤード | ロックは業務ルール。層の上で可視化する |
| Lint / Format | Biome 単体 | Oxlint（type-aware）＋ oxfmt / Oxlint ＋ Biome 整形 / ESLint ＋ Prettier | 1 ツール・1 設定のシンプルさを優先。floating promise の検出漏れはテストで補う |
| エラーハンドリング | 想定内のエラーだけ自前 Result 型、想定外は例外 | neverthrow（全層） / 自前 Result 型（全層） / 例外のみ | 当初は neverthrow（全層）を採用したが、チェーン（`andThen` 等）を使わず `isErr` の早期 return だけだったため、学習コストに見合わないとして自前の型に置き換えた（ts-pattern も同様に `switch` へ）。さらに、想定外の DB エラーを Result にしても全呼び出し側が上に渡して 500 にするだけだったため、例外のままにした。例外にすると Drizzle の Tx ロールバックやデッドロックのリトライとも素直に噛み合う |
| Fake LLM | 自作 `FakeLlmClient`（実 LLM なし） | LangChain の Fake / Vercel AI SDK のテスト用モデル / Claude API アダプター併設 | usage・切断・max_tokens を完全制御でき依存も増えない。費用ゼロで DB 学習に集中 |
| 用語 | クレジット付与（`credit_grants`） | ロット / バケット | Stripe Billing の Credit Grants と語彙を揃える。無償付与・購入を `source` で区別 |
| 残高の正本 | 自前 DB（お金は Stripe、クレジットは自前 DB） | Stripe Billing Credit Grants + Meters（後払い） | 送信ごとのリアルタイム判定が必要。Stripe 側は非同期集計・請求時相殺で、プリペイドの即時停止と噛み合わない |
