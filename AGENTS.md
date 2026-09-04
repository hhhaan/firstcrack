## Project
Roastery management desktop app (like Cropster): roast profile logging, roast history tracking, green bean inventory management.

## Commands
- setup: `pnpm setup` (pnpm install + sidecar venv + optional types:gen) — first clone / fresh machine
- package manager: **pnpm only** (`packageManager` field). Do not use npm/yarn; `package-lock.json` is gitignored.
- dev: `pnpm tauri dev` (desktop; vite:1420 + sidecar) | web-only `pnpm dev` (needs sidecar `.venv` — run `pnpm setup` if missing)
- build: `pnpm build` (frontend) | release `pnpm build:sidecar && pnpm tauri build` | local debug (macOS) `pnpm build:debug`
- test: `pnpm test` (vitest) | sidecar `pnpm verify:sidecar`
- lint: `pnpm check` (biome; CI gate) | `pnpm lint` (eslint, react-refresh)
- typecheck: `pnpm typecheck`
- verify: `pnpm verify:all` (check + typecheck + test + lint + sidecar) — run before push
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
| `git push` | `pnpm verify:all` | no |
| CI | `check` (typecheck+biome+i18n+registry+eslint+secrets), test, sidecar, semgrep (ERROR only), ios-check (`src-tauri/**` only) | no |
| `pnpm release` / `v*` tag | `supabase db push` then 3-platform build | no |
| repomix | manual — `pnpm repomix` at session start or after large/structural change | — |

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
Read before changing write paths:
- Inventory ledgers: `docs/inventory-architecture.md` · `docs/agent/inventory-ledger.md`
- Roast save / stock: `docs/agent/active-roast-save.md`
- Schedule / plan: `docs/agent/schedule-plan.md`
- Orders / channels: `docs/agent/sales-channels-orders.md`
- Workspace identity: `docs/agent/workspace-auth.md` (prefer over stale `docs/team-workspaces.md`)
- Data fetching: `docs/agent/data-fetching.md`
- Edge + migrations: `supabase/AGENTS.md`
- Gap inventory: `docs/agent/gap-inventory.md`

## Agent Rules
- When implementing/editing code: NO chat/greetings/summaries — output ONLY precise code diffs (modified lines only). (Reviews, evaluations, questions, and planning are exempt — answer normally.)
- repomix-output.xml: regenerate at session start and after large/structural changes (not every edit) via `pnpm repomix`.
- Commit: `git add` → `bash scripts/ai-commit.sh` (non-interactive gen-cmt wrapper; no manual commit messages). Never `git commit -m`.

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
- Upper → lower import: FORBIDDEN
- entities ↔ entities direct import: FORBIDDEN (route through shared)
- features → features direct import: FORBIDDEN (compose in widgets/views)
- views/* calling useQuery/useMutation/axios directly → move to entities or features

### Hook segment naming (per slice)
model:domain logic/state(useAuth) | lib:pure infra util(useDebounce) | api:query/mutation wrap(useRoastQuery) | ui:render-only local state(useModalAnimation)
mismatch→move to correct segment

## Architecture priority
Readability and maintainability matter more than reducing file count or line count. Do not sacrifice clear separation of concerns for a smaller diff.
When "smallest possible diff" conflicts with separation of concerns, SRP, or layer rules — architecture wins. Split files over squashing them.


## Cross-Platform
- CI: macOS arm64 only | x86_64+Windows: release-time only → don't trust CI for OS bugs
- paths: pathlib.Path (py) / Tauri app.path() (rust) | NO hardcode `/`, `~/Library/...`, string-concat
- env: NO assume HOME exists (unset on Windows) → Path.home() / platform-safe API
- shortcuts: Tauri `mod+` notation only | NO hardcode Cmd+/Ctrl+
- UI: NO custom titlebar/tray/window chrome → native OS UI only
- sidecar/native deps: Windows sidecar IS built at release (release.yml matrix) but never runtime-tested → serial/socket/driver code NOT Unix-path-assuming

- before tag: PR touched sidecar or path logic → manual full-matrix build first

## Wiki
Durable decisions, standing rules, open loops → `/Users/hanseungheon/wiki` same turn (`~/wiki/AGENTS.md`). Append `log.md`. Skip one-off chat, repo-local paths, secrets.
