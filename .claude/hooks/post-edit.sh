#!/usr/bin/env bash
# PostToolUse(Edit|Write)フック: src配下の.ts/.tsxを対象にoxlint --fix→oxfmtを適用し、
# 自動修正できずに残ったlintエラーだけexit 2でClaudeへフィードバックする。
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

case "$file" in
*.ts | *.tsx) ;;
*) exit 0 ;;
esac

case "$file" in
*/src/* | src/*) ;;
*) exit 0 ;;
esac

BIN="$CLAUDE_PROJECT_DIR/node_modules/.bin"

"$BIN/oxlint" --fix "$file" >/dev/null 2>&1 || true
"$BIN/oxfmt" "$file" >/dev/null 2>&1 || true

if ! out=$("$BIN/oxlint" "$file" 2>&1); then
	echo "$out" >&2
	exit 2
fi

exit 0
