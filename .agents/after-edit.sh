#!/bin/bash
# .agent/after-edit.sh

# 1. 포맷팅 및 린팅
pnpm biome check --write "$1" || pnpm format "$1"

# 2. 타입 체크 (TypeScript 파일일 때만 실행)
if [[ "$1" == *.ts ]] || [[ "$1" == *.tsx ]]; then
  pnpm tsc --noEmit
fi
