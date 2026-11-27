---
paths:
  - "apps/api/**"
  - "packages/**"
---

# null と undefined の使い分け

**値がないことは `null` で表す。`undefined` は「省略」のためだけに使う。**

DB（Drizzle）は NULL 許容の列も「見つからない」も `null` で返すため、型を DB と一致させる。
また Drizzle の `.set({ col: undefined })` は「NULL にする」ではなく「その列を更新しない」と黙って解釈されるため、値として `undefined` を持ち回らない。

## 規則

- **値がないことは `T | null` で表す。** 戻り値・ドメイン / ポートの型・リポジトリの結果・API のスキーマ（zod は `.nullable()`）が対象
  - 例: `findByClientMessageId(): Promise<SentMessage | null>`、`reply: { ... } | null`
- **`undefined` は省略にだけ使う。** 省略可能な引数・オプションのプロパティ（`?:`）、デフォルト引数
  - `T | undefined` を戻り値やデータの型として自分で定義しない
  - `exactOptionalPropertyTypes` が有効なので、`?:` のプロパティに `undefined` を明示的に代入しない（省略する）
- **ライブラリや言語が返す `undefined` は、その場で処理するか `?? null` で `null` に変換してから渡す。**
  - 例: `array.find()`、添字アクセス（`noUncheckedIndexedAccess`）、`c.req.header()`、`process.env.X`、`Map#get`
- **DB に NULL を書くときは必ず `null` を渡す。** `undefined` を渡すと列が更新・挿入の対象から外れる
- 値を返さない処理の戻り値（`void` / `Promise<void>`）はこの規則の対象外

## 判定

- 存在チェックは `=== null` / `!== null` を使う。`undefined` と両方を許す `== null` や truthy 判定で「値がない」を表さない（`0` や `''` を誤って除外するため）
  - 例外: ライブラリが返す `undefined` をその場で処理するときは `=== undefined` や `if (!row)` を使ってよい
