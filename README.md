# First Crack

로스터리 운영 데스크톱 앱 (Cropster 대안): 로스팅 프로파일 로깅, 로스팅 이력 관리, 생두/원두 재고 관리, 주문 연동.

## Stack

- **Desktop**: Tauri v2 (Rust) + React + TypeScript + Vite
- **Sidecar**: Python (aiohttp) — 로스터기 하드웨어 통신 (`src-tauri/sidecar/`)
- **Backend**: Supabase (Auth, DB, Edge Functions) + Cloudflare R2 (프로파일 저장)
- **State**: React Query (server) / Zustand (client) / Tauri Store (settings)
- **Quality**: Biome + ESLint + Vitest + pytest

## 시작하기

```bash
pnpm setup        # 최초 1회: pnpm install + sidecar venv 구성
pnpm tauri dev    # 데스크톱 개발 (vite:1420 + sidecar:9999)
pnpm dev          # 웹 전용 개발
```

패키지 매니저는 **pnpm 전용**. npm/yarn 사용 금지.

| 작업 | 명령 |
|------|------|
| 테스트 | `pnpm test` (vitest) / `pnpm verify:sidecar` (pytest) |
| 린트/타입 | `pnpm check` (biome) / `pnpm lint` (eslint) / `pnpm typecheck` |
| 전체 검증 | `pnpm verify:all` — push 전 필수 |
| 릴리스 빌드 | `pnpm build:sidecar && pnpm tauri build` |
| 버전 릴리스 | `pnpm release <major.minor.patch>` — 3개 매니페스트 동기 bump + tag + push |
| DB 타입 재생성 | `pnpm types:gen` — 스키마 마이그레이션 후 필수 |

## 구조

```
src/                  # 프론트엔드 — FSD 레이어 (shared → entities → features → widgets → views → app)
src-tauri/            # Tauri Rust 셸
src-tauri/sidecar/    # Python 사이드카: main.py(HTTP :9999) + manager.py + adapters/
supabase/             # 마이그레이션 + Edge Functions (presigned URL, 주문 연동, 결제 웹훅 등)
scripts/              # setup/build/release/검증 스크립트
docs/                 # 상세 문서 (아래 인덱스)
```

개발 규칙(FSD 레이어 규칙, SRP, 커밋 훅, 시크릿 정책)은 [AGENTS.md](AGENTS.md), 디자인 토큰은 [DESIGN.md](DESIGN.md) 참고.

## 문서 인덱스 (docs/)

- [sidecar-api.md](docs/sidecar-api.md) — 사이드카 HTTP API 레퍼런스
- [phidget-driver-setup.md](docs/phidget-driver-setup.md) — Phidget 시스템 드라이버 설치
- [inventory-architecture.md](docs/inventory-architecture.md) — 재고 도메인
- [MOBILE.md](docs/MOBILE.md) — 모바일 전략
- [abstraction-roi.md](docs/abstraction-roi.md) — 추상화 ROI 가이드

`docs/`의 나머지는 로컬 전용 작업 문서(gitignored): 배포/릴리스 절차(RELEASE, DEPLOY, UPDATER, SENTRY), 아키텍처 노트(registry-and-connection, simulator-architecture, data-fetching), 도메인/연동 기획(order-status-sync, cafe24-oauth-setup, cupping, team-workspaces, db-cost-*, pricing/, research/). 공유가 필요해지면 `git add -f`로 개별 트래킹.
