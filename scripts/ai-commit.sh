#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

PROMPT_FILE="$ROOT/scripts/hilokal-commit-prompt.txt"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this script inside a Git repository." >&2
  exit 1
fi

if git diff --cached --quiet; then
  echo "No staged changes. Stage files with git add, then run again." >&2
  exit 1
fi

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Convention prompt file not found: $PROMPT_FILE" >&2
  exit 1
fi

exec npx @hanseungheon/gen-cmt \
  --customPrompt "$PROMPT_FILE" \
  --language en \
  --maxFirstLineLength 72 \
  --fallbackMessage "chore: update code" \
  "$@"