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
| Test | `pnpm test` (vitest) / `pnpm test:e2e` (playwright) / `pnpm verify:sidecar` (pytest) |
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

## Docs index

### Agent guides (English — primary for coding agents)

- [docs/agent/gap-inventory.md](docs/agent/gap-inventory.md) — domain gap map + what was documented
- [docs/inventory-architecture.md](docs/inventory-architecture.md) — 3-ledger inventory SSoT (writes, RPCs, idempotency)
- [docs/agent/inventory-ledger.md](docs/agent/inventory-ledger.md) — inventory quick index
- [docs/agent/active-roast-save.md](docs/agent/active-roast-save.md) — roast save, deduct, R2 curves
- [docs/agent/schedule-plan.md](docs/agent/schedule-plan.md) — plan/recurrence writes + batch stock
- [docs/agent/sales-channels-orders.md](docs/agent/sales-channels-orders.md) — channels, fulfill/dispatch/cancel
- [docs/agent/workspace-auth.md](docs/agent/workspace-auth.md) — workspace owner id / RLS identity
- [docs/agent/data-fetching.md](docs/agent/data-fetching.md) — React Query invalidation conventions
- [supabase/AGENTS.md](supabase/AGENTS.md) — Edge Functions catalog, secrets, write authority

### Other tracked docs

- [sidecar-api.md](docs/sidecar-api.md) — Sidecar HTTP API reference
- [phidget-driver-setup.md](docs/phidget-driver-setup.md) — Phidget system driver install
- [MOBILE.md](docs/MOBILE.md) — Mobile strategy
- [abstraction-roi.md](docs/abstraction-roi.md) — Abstraction ROI guide

Other files under `docs/` are local working notes (gitignored): deploy/release (RELEASE, DEPLOY, UPDATER, SENTRY), architecture notes (registry-and-connection, simulator-architecture), domain/integration planning (order-status-sync, cafe24-oauth-setup, cupping, team-workspaces, db-cost-*, pricing/, research/). Force-track with `git add -f` when sharing.
