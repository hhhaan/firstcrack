
## Database Rules

When making **any schema change** (new table, new column, index, RLS policy, etc.):

1. Apply the migration via `mcp__claude_ai_Supabase__apply_migration`
2. **Immediately after**, regenerate types:
   ```bash
   npm run types:gen
   ```
3. Commit the updated `src/shared/types/database.types.ts` together with the feature code.

Never manually edit `database.types.ts` above the `// ── Convenience aliases ──` line — that section is auto-generated.

## Component Design Rules

- All components and functions must be declared as `export const` arrow functions.
- Use Tailwind CSS classes for styling. Do not use separate CSS files or inline style attributes.
- `font-variant-numeric: tabular-nums` is set globally in `App.css` on `body`. Do not re-declare it per-component.
  ```tsx
  // Correct
  export const MyComponent = () => { ... }
  export const myFunction = () => { ... }

  // Do not use
  export default function MyComponent() { ... }
  function myFunction() { ... }
  ```

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## Karpathy Coding Guidelines

These apply automatically whenever writing, editing, or reviewing code:

**1. Think Before Coding** — State assumptions explicitly. If multiple interpretations exist, present them. If something is unclear, ask before implementing.

**2. Simplicity First** — Minimum code that solves the problem. No speculative features, no abstractions for single-use code, no unnecessary configurability.

**3. Surgical Changes** — Touch only what the request requires. Don't "improve" adjacent code. Match existing style. Remove only imports/variables made unused by YOUR changes.

**4. Goal-Driven Execution** — Define verifiable success criteria before starting. For multi-step tasks, state a brief plan with verification steps.

> Full skill: invoke `andrej-karpathy-skills:karpathy-guidelines`

---

## Project Overview

**First Crack** is a specialty coffee roastery management desktop application. It provides real-time roast monitoring, bean inventory management, temperature profiling, and batch scheduling.

**Stack:** Tauri v2 (Rust desktop shell) + React 19 + TypeScript + Vite 7 + Tailwind CSS v4 + Supabase + Python sidecar for hardware device communication.

---

## Repository Structure

```
first-crack-agent/
├── src/                        # Frontend React/TypeScript
│   ├── main.tsx                # Entry point
│   ├── App.tsx                 # Root component (routing, auth, view switching)
│   ├── App.css                 # Global styles & design tokens (CSS variables)
│   ├── entities/               # Domain models: API + React Query hooks
│   ├── features/               # Business logic: pure functions + stateful hooks
│   ├── views/                  # Page-level components (routing destinations)
│   ├── widgets/                # Reusable compound components (modals, sidebar)
│   └── shared/                 # Cross-cutting: utils, stores, types, UI primitives
├── src-tauri/                  # Tauri desktop wrapper
│   ├── src/                    # Rust Tauri commands
│   ├── capabilities/           # Plugin permission declarations
│   └── sidecar/                # Python aiohttp server for device communication
│       ├── main.py             # HTTP server (port 9999)
│       ├── manager.py          # RoasterManager state machine
│       ├── roaster_registry.py # Supported device definitions
│       └── adapters/           # Protocol drivers (virtual, phidget, kaleido, modbus, s7, probat_ws)
├── supabase/
│   ├── migrations/             # SQL migration files (timestamped)
│   └── config.toml             # Supabase project config
├── scripts/                    # Build & utility scripts
├── docs/                       # Additional documentation
├── DESIGN.md                   # Complete design system specification
└── AGENTS.md                   # Agent-specific guidance (Tauri, sidecar, UI)
```

---

## Architecture: Entity-Feature-View-Widget (EFVW)

### Layer responsibilities

| Layer | Path | Responsibility |
|-------|------|----------------|
| **Entities** | `src/entities/` | Domain models: API functions + React Query hooks |
| **Features** | `src/features/` | Business logic: pure functions (`lib/`) + stateful hooks (`model/`) |
| **Views** | `src/views/` | Page components — orchestrate entities, features, widgets |
| **Widgets** | `src/widgets/` | Compound components: modals, sidebar, complex clusters |
| **Shared** | `src/shared/` | Infrastructure: Supabase client, Zustand stores, types, i18n, UI primitives |

### Entity pattern

Each entity (`bean`, `roast`, `plan`, `machine`, `profile`, `bean-inventory`) follows:

```
src/entities/<name>/
├── index.ts        # Barrel exports
├── api.ts          # Raw API calls (Supabase REST)
└── queries.ts      # React Query hooks (useQuery / useMutation)
```

### Feature pattern

```
src/features/<name>/
├── index.ts
├── lib/            # Pure functions (no React imports)
└── model/          # React hooks + state
```

### Data flow

```
View/Widget → React Query hook (queries.ts) → API function (api.ts) → Supabase
                                                                      ↕
                                                              database.types.ts
```

---

## Path Aliases

Defined in `tsconfig.json` and mirrored in `vite.config.ts`:

| Alias | Maps to |
|-------|---------|
| `@shared/*` | `src/shared/*` |
| `@entities/*` | `src/entities/*` |
| `@features/*` | `src/features/*` |
| `@views/*` | `src/views/*` |
| `@widgets/*` | `src/widgets/*` |

Always use aliases — never relative paths crossing layer boundaries.

---

## State Management

| Concern | Tool |
|---------|------|
| Server/async state | React Query (`@tanstack/react-query` v5) |
| Global app state | Zustand v5 (`src/shared/store/`) |
| Settings persistence | Tauri `LazyStore` (not localStorage) |
| Local UI state | React `useState` |

Key stores:
- `src/shared/store/auth.ts` — Current user + plan tier (`free`/`pro`/`team`)
- `src/shared/store/workspace.ts` — Active workspace name

---

## Styling Conventions

- **Tailwind v4** — Configured inline via `@theme` blocks in `App.css` (no separate `tailwind.config.*`)
- **CSS variables** for design tokens: `--color-primary`, `--color-surface`, `--color-surface-warm`, shadow stacks, etc.
- **No inline `style` props** — use Tailwind utility classes only
- **No per-component CSS files** — only `App.css` for globals
- **Icons** — Lucide React only. No emojis.
- **Buttons** — Pill-shaped (`rounded-full` / 9999px radius), warm shadow
- **Shadows** — Multi-layer, low-opacity (<0.1), warm-tinted (`rgba(78,50,23,0.04)`)
- **Font** — Inter (primary), Pretendard fallback; tabular-nums globally on `body`

See `DESIGN.md` for the full design system spec.

---

## Internationalization

- **Library:** i18next + react-i18next
- **Supported languages:** `ko`, `en`, `ja`, `zh-CN`
- **Locale files:** `src/shared/i18n/locales/<lang>.json`
- **Rule:** All user-visible strings go in locale files — never hardcode UI text.
- Language is detected from system locale and stored in Tauri `LazyStore`.

---

## Tauri v2 Integration

- **Dev server:** `http://localhost:1420` (fixed port), HMR on 1421
- **Permissions:** `src-tauri/capabilities/default.json`
- **OAuth deep-link:**
  - Dev: `http://localhost:1420/auth/callback?code=…`
  - Prod: `firstcrack://auth/callback?code=…`
- **Plugins in use:** `deep-link`, `dialog`, `fs`, `opener`, `os`, `process`, `store`, `updater`
- **Do not** add new Tauri commands without updating `capabilities/default.json`.

---

## Python Sidecar (Device Layer)

The sidecar runs as a subprocess managed by Tauri. It exposes a local HTTP API on `http://127.0.0.1:9999` for hardware device communication.

**Key files:**
- `src-tauri/sidecar/main.py` — aiohttp server, route handlers
- `src-tauri/sidecar/manager.py` — `RoasterManager` state machine
- `src-tauri/sidecar/roaster_registry.py` — Supported device definitions + UI form fields
- `src-tauri/sidecar/adapters/` — Protocol drivers:
  - `virtual.py` — Simulator (dev/testing without hardware)
  - `phidget.py` — Phidget USB sensors
  - `kaleido.py` — Kaleido roasters
  - `modbus.py` — Modbus protocol
  - `s7.py` — Siemens S7 protocol
  - `probat_ws.py` — Probat WebSocket protocol

**HTTP API endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/roasters` | List supported roasters + connection form fields |
| GET | `/status` | Current connection state |
| POST | `/connect` | Connect to device `{roaster, host, ...}` |
| POST | `/disconnect` | Disconnect |
| GET | `/temperatures` | Live readings `{bt, et, ror, heater, fan, timestamp}` |
| POST | `/start` | Charge (resets timer) |
| POST | `/control` | Adjust controls `{heater?, fan?, drum?}` |

Frontend client: `src/shared/lib/sidecar.ts`

---

## NPM Scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Vite dev server + Python sidecar (`concurrently`) |
| `npm run build` | `tsc` type-check + Vite build |
| `npm run build:debug` | Build sidecar + Tauri debug build, opens `.app` on macOS |
| `npm run build:sidecar` | PyInstaller bundle via `scripts/build-sidecar.sh` |
| `npm run types:gen` | Regenerate `database.types.ts` from linked Supabase project |
| `npm run lint` | ESLint (zero-warnings enforced) |
| `npm run lint:fix` | ESLint auto-fix |

**Note:** `predev` kills any process on port 9999 before starting.

---

## Code Quality

- **ESLint** with `typescript-eslint` recommended, `react-hooks`, `react-refresh` plugins
- **Pre-commit:** husky + lint-staged runs `eslint src --max-warnings=0`
- **No test framework** — no Jest/Vitest; verify features manually
- **TypeScript strict mode** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` all enabled

---

## Views Reference

| View | File | Purpose |
|------|------|---------|
| Login | `src/views/login/Login.tsx` | Auth (OAuth + email/password) |
| Dashboard | `src/views/dashboard/Dashboard.tsx` | Home, quick actions, current batch |
| Active Roast | `src/views/active-roast/ActiveRoast.tsx` | Live roasting: real-time temps, event log, controls |
| History | `src/views/history/` | Past roasts, export, analytics |
| Beans | `src/views/bean/` | Inventory management |
| Profiles | `src/views/profiles/` | Roast profile library |
| Machines | `src/views/machines/` | Roaster hardware configuration |
| Schedule | `src/views/schedule/` | Batch planning & calendar |
| Reports | `src/views/reports/` | Monthly production analytics |

View type union: `src/shared/types/view.ts`

---

## Key Shared Utilities

| File | Purpose |
|------|---------|
| `src/shared/lib/supabase.ts` | Typed Supabase client (`createClient<Database>`) |
| `src/shared/lib/sidecar.ts` | HTTP client for Python sidecar API |
| `src/shared/lib/cn.ts` | `clsx` + `tailwind-merge` class helper |
| `src/shared/types/database.types.ts` | **Auto-generated** Supabase types — do not edit above the aliases line |
| `src/shared/types/roast.ts` | `RoastPoint`, `LogEntry`, `ChartDataPoint` interfaces |
| `src/shared/types/view.ts` | View name union type |
