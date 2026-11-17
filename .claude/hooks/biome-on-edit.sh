#!/usr/bin/env bash
# PostToolUse（Write|Edit）: 編集したファイルを Biome で自動修正（format・import 整列・安全な lint 修正）する。
# 自動で直せないエラーが残ったら exit 2 で Claude に返し、その場で直させる。
# Biome の対象外のファイル（Markdown・drizzle/meta・未対応の拡張子）は何もしない。
# 依存: jq, pnpm（@biomejs/biome は devDependency）

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd')}" || exit 0

if ! output=$(pnpm exec biome check --write --colors=off \
  --no-errors-on-unmatched --files-ignore-unknown=true "$file" 2>&1); then
  printf 'Biome で自動修正できないエラーがあります。修正してください: %s\n\n%s\n' "$file" "$output" >&2
  exit 2
fi
exit 0
