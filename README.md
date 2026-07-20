# First Crack

Roastery management desktop app (Cropster alternative): roast profile logging, roast history, green/roasted bean inventory, and order integrations.

## Stack

- **Desktop**: Tauri v2 (Rust) + React + TypeScript + Vite
- **Sidecar**: Python (aiohttp) — roaster hardware comms (`src-tauri/sidecar/`)
- **Backend**: Supabase (Auth, DB, Edge Functions) + Cloudflare R2 (profile storage)
- **State**: React Query (server) / Zustand (client) / Tauri Store (settings)
- **Quality**: Biome + ESLint + Vitest + pytest

## Getting started

```bash
pnpm setup        # first time: pnpm install + sidecar venv
pnpm tauri dev    # desktop dev (vite:1420 + sidecar:9999)
pnpm dev          # web-only dev
```

Package manager is **pnpm only**. Do not use npm/yarn.

| Task | Command |
|------|---------|
| Test | `pnpm test` (vitest) / `pnpm verify:sidecar` (pytest) |
| Lint / types | `pnpm check` (biome) / `pnpm lint` (eslint) / `pnpm typecheck` |
| Full verify | `pnpm verify:all` — required before push |
| Release build | `pnpm build:sidecar && pnpm tauri build` |
| Version release | `pnpm release <major.minor.patch>` — sync-bump 3 manifests + tag + push |
| Regenerate DB types | `pnpm types:gen` — required after schema migrations |

## Structure

```
src/                  # Frontend — FSD layers (shared → entities → features → widgets → views → app)
src-tauri/            # Tauri Rust shell
src-tauri/sidecar/    # Python sidecar: main.py(HTTP :9999) + manager.py + adapters/
supabase/             # Migrations + Edge Functions (presigned URLs, order sync, payment webhooks, etc.)
scripts/              # setup / build / release / verify scripts
docs/                 # Detailed docs (index below)
```

Dev rules (FSD layers, SRP, commit hooks, secrets policy): [AGENTS.md](AGENTS.md). Design tokens: [DESIGN.md](DESIGN.md).

## Docs index (`docs/`)

- [sidecar-api.md](docs/sidecar-api.md) — Sidecar HTTP API reference
- [phidget-driver-setup.md](docs/phidget-driver-setup.md) — Phidget system driver install
- [inventory-architecture.md](docs/inventory-architecture.md) — Inventory domain
- [MOBILE.md](docs/MOBILE.md) — Mobile strategy
- [abstraction-roi.md](docs/abstraction-roi.md) — Abstraction ROI guide

Other files under `docs/` are local working notes (gitignored): deploy/release (RELEASE, DEPLOY, UPDATER, SENTRY), architecture notes (registry-and-connection, simulator-architecture, data-fetching), domain/integration planning (order-status-sync, cafe24-oauth-setup, cupping, team-workspaces, db-cost-*, pricing/, research/). Track individually with `git add -f` if they need to be shared.
