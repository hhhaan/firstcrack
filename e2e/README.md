# E2E suite (Playwright)

**Manual only — not run in CI or `pnpm verify`.** Forty-one specs under `e2e/tests/`; run locally when you change browser flows, fixtures, or the sidecar mock.

Browser e2e against the **real Vite app entry** (`src/main.tsx` → `App`).  
Supabase Auth/PostgREST are route-mocked with an in-memory DB; sidecar is a local HTTP mock on `:9999`. Tauri APIs are stubbed for Chromium.

## Run

Full suite:

```bash
pnpm test:e2e
```

Single file:

```bash
pnpm exec playwright test --config e2e/playwright.config.ts e2e/tests/shell.spec.ts
```

Typecheck (included in `pnpm typecheck`):

```bash
pnpm exec tsgo --noEmit -p tsconfig.e2e.json
```

## Env

`webServer` forces:

- `VITE_SUPABASE_URL=https://e2e.supabase.local`
- `VITE_SUPABASE_ANON_KEY=e2e-anon-key`
- `VITE_E2E=1` (installs `window.__FC_E2E__` handoff bridge for F3 case)

No live Supabase credentials required. **Port 9999 must be free** — global setup fails if a real sidecar is already listening.

## Out of scope (manual)

- Marketplace OAuth / order-sync
- Two-account workspace invite
- Real machine hardware / full live Charge→Drop temperature integrity
- Native Tauri desktop shell (this suite is web-mode)
