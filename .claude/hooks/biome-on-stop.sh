#!/usr/bin/env bash
# Stop: 応答を終える前にリポジトリ全体を Biome（pnpm lint と同じ biome check .）で検査する。
# エラーがあれば exit 2 で応答を終わらせず、Claude に修正させる。
# 無限ループ防止: このフックが一度止めた後の再停止（stop_hook_active = true）では検査しない。
# 依存: jq, pnpm（@biomejs/biome は devDependency）

input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd')}" || exit 0

if ! output=$(pnpm exec biome check --colors=off . 2>&1); then
  printf 'Biome（pnpm lint）でエラーがあります。応答を終える前に修正してください。\n\n%s\n' "$output" >&2
  exit 2
fi
exit 0
