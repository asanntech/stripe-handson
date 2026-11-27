---
paths:
  - "apps/api/src/**"
---

# 分岐の書き方（Result / switch / if）

## 規則

- **Result の成功 / 失敗は `if (!result.ok)` の早期 return で分ける。** 失敗側はそのまま `return result` で上に返してよい（型が `{ ok: false; error }` に絞られるため）
- **判別可能なユニオンを網羅的に変換するときは `switch (x.type)` と `default` の `satisfies never` を使う。**
  - 例: ユースケースのエラー → contract の型付きエラー（`interfaces/orpc/router.ts`）
  - `default` では `x satisfies never` を書く。ユニオンに種類を足して変換し忘れると typecheck で止まる。`default` で「残りは全部」にまとめない（変換漏れが黙って既定の扱いになるため）
  - 同じ扱いにまとめる種類は `case` を並べて列挙する（空の `case` のフォールスルー）
- **2〜3 分岐の単純な条件や、早期 return のガードは `if` のまま書く。**
- パターンマッチ・Result のライブラリ（ts-pattern / neverthrow など）は使わない（`docs/plan.md`「エラーハンドリング方針」）
