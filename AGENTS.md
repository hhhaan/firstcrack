## Project
Roastery management desktop app (like Cropster): roast profile logging, roast history tracking, green bean inventory management.

## Commands
- setup: `pnpm setup` (pnpm install + sidecar venv + optional types:gen) — first clone / fresh machine
- package manager: **pnpm only** (`packageManager` field). Do not use npm/yarn; `package-lock.json` is gitignored.
- dev: `pnpm tauri dev` (desktop; vite:1420 + sidecar) | web-only `pnpm dev` (needs sidecar `.venv` — run `pnpm setup` if missing)
- build: `pnpm build` (frontend) | release `pnpm build:sidecar && pnpm tauri build` | local debug (macOS) `pnpm build:debug`
- test: `pnpm test` (vitest) | sidecar `pnpm verify:sidecar`
- lint: `pnpm check` (biome; CI gate) | `pnpm lint` (eslint, react-refresh)
- knip: `pnpm knip` (unused files + dependencies)
- typecheck: `pnpm typecheck`
- verify: `pnpm verify:all` runs the full local gate in parallel, stopping on failure. The push hook uses `verify:push` to select related tests and sidecar/workflow checks from outgoing refs; only `README.md`, `AGENTS.md`, `CONTEXT.md`, and `docs/**/*.md` changes skip checks. Uncertain ranges, dirty trees, and shared config changes run the full gate.
- fix: `pnpm check:fix` | `types:gen` after DB schema migration

## Versioning
SSoT: `version` field in `tauri.conf.json`. Bump all 3 atomically (`package.json`, `tauri.conf.json`, `Cargo.toml`):
```bash
pnpm release patch|minor|major   # auto: max(package.json, max tag) +1
pnpm release <major.minor.patch> # explicit (must be > baseline)
```
This runs: version resolve + downgrade/tag guards → preflight → bump → commit → tag → push.
Guards (always): target ≤ baseline 거부, 기존 로컬/remote 태그 거부. Preflight only: `--force`.

CI "Sync version across manifests" overwrites from tag — tag is final authority.

## Automation
| When | What runs | Auto-fix? |
|------|-----------|-----------|
| `git commit` | lint-staged → `biome check --write` on **staged files only** + secretlint | yes; lint-staged re-stages fixed files |
| `git commit` (2) | migration staged w/o `database.types.ts` → block (bypass `SKIP_TYPES_GEN=1`) | no |
| `git commit` (3) | staged release manifests or version guard changes → check version sync in index | no |
| `git push` | `pnpm verify:push`: related tests for scoped frontend changes; sidecar/actionlint by changed area; full gate on uncertain scope | no |
| main push `supabase/functions/**` | EF deploy → POST probe each deployed fn (transport errors/5xx/BOOT_ERROR = fail) | no |
| CI (PR and main — main direct push is still possible) | Always: `check` (biome+i18n+registry+plan-caps+harness+knip+typecheck+eslint+secretlint+dependency-cruiser+bundle, one install), test, semgrep (ERROR only), gitleaks (this change), actionlint, zizmor. PR only: clippy, sidecar, edge-check run when that area changes (`scripts/ci-changed-areas.mjs`); a shared CI config change or an untrusted diff runs all three. main push always runs those three. ios-check off until iPad (`IOS_CHECK=true` and `src-tauri/**`). React Doctor skips the same docs-only paths as CI. | no |
| schedule (Mon 09:00 KST) | gitleaks (HEAD tree + last 7d history) | no |
| `pnpm release` / `v*` tag | 3-platform build (+ sidecar `/status` smoke) → `supabase db push` → R2 publish | no |

### Hook bypass (use sparingly)
CI still runs on remote — local skip is **not** a quality pass.

| Hook | Allowed bypass | When OK | Not OK |
|------|----------------|---------|--------|
| pre-commit types guard | `SKIP_TYPES_GEN=1 git commit` | RLS/GRANT-only migration (no schema types change) | schema migration without `pnpm types:gen` |
| pre-push verify | `SKIP_VERIFY=1 git push` | emergency hotfix push; known-green WIP while CI is the gate | habit; untested main; to avoid fixing failing tests |
| any hook | `git commit/push --no-verify` | last resort only (broken hook env) | default workflow |

Prefer `SKIP_VERIFY=1` over `--no-verify` (keeps other hooks; explicit intent in shell history).

## External Services
- Supabase: BaaS — auth, DB (roast records, inventory), Edge Functions (R2, channels, Polar, cupping). Catalog: `supabase/AGENTS.md`
- R2: storage — roast profiles via presigned URL (upload/download issued by Edge Function; credentials never in client)
- Sales channels: Naver / Shopify / Cafe24 — desktop never holds platform secrets; see `docs/agent/sales-channels-orders.md`
- Slack webhook: CI/CD notifications + signup notify EF only

## Security — Secrets
- NO `VITE_*` prefix for any secret → bundled into client JS, extractable. If found: rotate immediately, don't just remove
- R2/S3 from frontend: NO direct credentials → presigned URL only (issued by Edge Function)
- presigned URL: ≤5min expiry, scoped to single key, validate user ownership
- `sales_channel_secrets`, Polar/billing columns, service role: server/EF only — see `supabase/AGENTS.md`

## Agent domain docs (English)
Roast-session language (temperatures, phases, controls, replay): `CONTEXT.md`. Read it before naming those terms.
Read before changing write paths:
- Inventory ledgers: `docs/inventory-architecture.md` · `docs/agent/inventory-ledger.md`
- Roast save / stock: `docs/agent/active-roast-save.md`
- Schedule / plan: `docs/agent/schedule-plan.md`
- Orders / channels: `docs/agent/sales-channels-orders.md`
- Workspace identity: `docs/agent/workspace-auth.md` (prefer over stale `docs/team-workspaces.md`)
- Data fetching: `docs/agent/data-fetching.md`
- Edge + migrations: `supabase/AGENTS.md` — migration edits: local `supabase db reset --local` (Docker) passes before commit
- Gap inventory: `docs/agent/gap-inventory.md`
- Sentry capture: `## Sentry` below — read before adding a failure report

## Agent Rules
- When implementing/editing code: NO chat/greetings/summaries — output ONLY precise code diffs (modified lines only). (Reviews, evaluations, questions, and planning are exempt — answer normally.)
- Commit: `git add` then `git commit` with a conventional message the agent writes (`feat|fix|refactor|docs|style|test|chore`, first line ≤72). Never run `scripts/ai-commit.sh` or gen-cmt, and do not ask.

## Sentry
One project. Split only by tag `runtime`: `webview` | `tauri` | `sidecar` | `edge`. Release `first-crack@<app version>`. Do not add a DSN, `Sentry.init`, or a second client.

Init (do not duplicate):
- web: `src/shared/lib/sentry.ts` — on when `import.meta.env.PROD` or `VITE_SENTRY_SMOKE`
- rust: `src-tauri/src/sentry_config.rs` (`runtime=tauri`)
- sidecar: `src-tauri/sidecar/sentry_config.py` — packaged/Tauri spawn, or `SIDECAR_SENTRY_SMOKE`; `SIDECAR_DISABLE_SENTRY` wins
- edge: `supabase/functions/_shared/sentry.ts` — optional `SENTRY_DSN`; missing DSN is a no-op

A new failure path calls the existing helper once:
- web, outside React Query: `logger.capture(error, { feature })` from `@shared/lib/logger`. QueryCache/MutationCache already call `reportReactQueryError`. React 19 root uses `reactRootOptions`. Do not capture from an ErrorBoundary. Features do not import `@sentry/react` to capture.
- sidecar retry: `RoasterManager._capture_hardware_error(..., once=True)`
- rust: `sentry::capture_message` only when recovery is exhausted (first spawn fail, `sidecar-dead`). A retry is a breadcrumb (`src-tauri/src/lib.rs`).
- edge: `serveWithSentry(name, handler)`. A non-throwing 500 uses `respondServerError` or `captureEdgeException`, not both. Status under 500 is dropped.

Do not double-capture a path already reported by React Query, the React root handler, or sidecar `sentryReported` (including SidecarHttpError 502 and 400).

Context tags: `feature`, `rpc`, `table`. Edge also `function`. Do not put host, port, serial, path, token, email, or user text in tags or extra. Scrubbing stays in `beforeSend` / `before_send` only.

Dropped: AbortError, user cancel, opaque network, HTTP 4xx except 429 (edge: anything under 500). Do not blanket-capture polling (`useSidecarPolling` temperature fetch, per-tick BBP writes, `persistLive`).

A new function on `sentry.ts` or `sentry_config.py` only for a non-exception fingerprint or session dedupe, with the matching test.

## Sidecar
- src-tauri/sidecar/: main.py(aiohttp :9999) + manager.py + adapters/ (modbus,phidget,kaleido,probat_ws,s7,virtual)
- registry dual SSoT (manual sync): `src-tauri/sidecar/roaster_registry.py` (connect + address maps) ↔ `src/entities/machine/roasterRegistry.ts` (UI form/display). Gate: `pnpm check:registry` (in `verify`)
- API doc: docs/sidecar-api.md
- Phidget: OS-level libphidget22 필요 → docs/phidget-driver-setup.md

## Design
- values/vars: `DESIGN.md` (SSoT)
- NO emoji → Lucide | tw utility > style prop

## State
server data→ReactQuery | settings→TauriStore(LazyStore) | CRUD lists→Zustand+persist | session→Zustand

- Store: single settings.json, key=`domain.field`, singleton LazyStore, high-freq writes debounce 200ms+save(), localStorage fallback
- Zustand persist: key prefix=`fc_`, exclude fields→partialize, rehydrate→merge
- Zustand pure: src/shared/store/*.ts | entities/<slice>/model.ts | NO persist: auth, roast session, sensors

## Fetch
ReactQuery+axios | NO useEffect fetch
- api.ts: raw axios | queries.ts: reads | use<X>.ts: writes
- mutation→invalidateQueries | NO refetch()
- staleTime:Infinity(global)

## FSD
Unidirectional: shared → entities → features → widgets → views → app
- Lower → upper import: FORBIDDEN
- entities ↔ entities direct import: FORBIDDEN (route through shared)
- features → features direct import: FORBIDDEN (compose in widgets/views)
- views/* calling useQuery/useMutation/axios directly → move to entities or features

### Hook segment naming (per slice)
model:domain logic/state(useAuth) | lib:pure infra util(useDebounce) | api:query/mutation wrap(useRoastQuery) | ui:render-only local state(useModalAnimation)
mismatch→move to correct segment

## Architecture priority
Readability and maintainability matter more than reducing file count or line count. Do not sacrifice clear separation of concerns for a smaller diff.
When "smallest possible diff" conflicts with separation of concerns, SRP, or layer rules — architecture wins. Split files over squashing them.
Necessary complexity: preserve or add complexity required by current behavior, including sensor noise handling, connection recovery, data preservation, and safe machine control. Simplify redundant state and coordination; fewer lines are not a goal at the expense of correctness.


## Cross-Platform
- CI: Ubuntu for core checks; optional macOS iOS check (`IOS_CHECK=true`). Release: macOS arm64 + macOS x86_64 + Windows → CI does not prove desktop OS compatibility
- paths: pathlib.Path (py) / Tauri app.path() (rust) | NO hardcode `/`, `~/Library/...`, string-concat
- env: NO assume HOME exists (unset on Windows) → Path.home() / platform-safe API
- shortcuts: Tauri `mod+` notation only | NO hardcode Cmd+/Ctrl+
- UI: NO custom titlebar/tray/window chrome → native OS UI only
- sidecar/native deps: Windows sidecar IS built at release (release.yml matrix) but never runtime-tested → serial/socket/driver code NOT Unix-path-assuming

- before tag: PR touched sidecar or path logic → manual full-matrix build first

## Wiki
Durable decisions, standing rules, open loops → `/Users/hanseungheon/wiki` same turn (`~/wiki/AGENTS.md`). Append `log.md`. Skip one-off chat, repo-local paths, secrets.
