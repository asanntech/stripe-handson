---
paths:
  - "apps/api/src/**"
---

# 分岐の書き方（ts-pattern / switch / neverthrow の match）

## 規則

- **判別可能なユニオンを網羅的に変換するときは ts-pattern の `match(...).with(...).exhaustive()` を使う。**
  - 例: ユースケースのエラー → contract の型付きエラー（`interfaces/orpc/router.ts`）
  - 必ず `.exhaustive()` で終える。ユニオンに種類を足して変換し忘れると typecheck で止まる。`.otherwise()` で「残りは全部」にまとめない（変換漏れが黙って既定の扱いになるため）
  - 同じ扱いにまとめる種類は `P.union(...)` で列挙する
  - `type` 以外のフィールドも見て振り分ける（例: `{ type: 'database_error', retryable: true }`）ときも、`if` を入れ子にせずパターンで書く
- **2〜3 分岐の単純な条件や、早期 return のガードは `if` のまま書く。** すべての分岐を ts-pattern に置き換えない
- **neverthrow の `result.match(ok, err)` とは役割を分ける。**
  - neverthrow の `match`: Result の成功 / 失敗の分岐
  - ts-pattern の `match`: 値の形（判別可能なユニオンの種類）での分岐
  - 失敗側のエラーの種類で分岐するときは、`result.isErr()` などで取り出したエラーに ts-pattern を使う

## domain 層での利用

domain 層は I/O・副作用・フレームワークに依存しない。使ってよいのは **純粋なライブラリの許可リスト** だけで、ts-pattern はこれに含まれる（CLAUDE.md の「アーキテクチャ」を参照）。
