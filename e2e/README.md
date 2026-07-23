# E2E suite (Playwright)

Browser e2e against the **real Vite app entry** (`src/main.tsx` → `App`).  
Supabase Auth/PostgREST are route-mocked with an in-memory DB; sidecar is a local HTTP mock on `:9999`. Tauri APIs are stubbed for Chromium.

## Run

```bash
pnpm test:e2e
```

Single file:

```bash
pnpm exec playwright test --config e2e/playwright.config.ts e2e/tests/shell.spec.ts
```

## Cases

| Spec | Criterion |
|------|-----------|
| `shell.spec.ts` | 2a authenticated shell → dashboard / nav |
| `bean-purchase.spec.ts` | 2b create bean lot + stock visible |
| `roast-save-deduct.spec.ts` | 2c roast save with deduct → history + stock− |
| `f3-no-double-deduct.spec.ts` | 2d schedule already deducted → no double green |

## Env

`webServer` forces:

- `VITE_SUPABASE_URL=https://e2e.supabase.local`
- `VITE_SUPABASE_ANON_KEY=e2e-anon-key`
- `VITE_E2E=1` (installs `window.__FC_E2E__` handoff bridge for F3 case)

No live Supabase credentials required.

## Out of scope (manual)

- Marketplace OAuth / order-sync
- Two-account workspace invite
- Real machine hardware / full live Charge→Drop temperature integrity
- Native Tauri desktop shell (this suite is web-mode)
