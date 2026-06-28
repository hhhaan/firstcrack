# AGENTS.md

## lazy senior dev mode (lazy=efficient, NOT careless; best code=code never written)
ladder, before coding, stop at first rung that holds:
1.needed at all?(YAGNI) 2.already in codebase?reuse, don't rewrite 3.stdlib does it?use 4.native platform feature?use 5.installed dep solves it?use 6.one-line possible?do it 7.else: minimum code that works
ladder runs AFTER understanding problem, not instead: trace real flow end-to-end first, climb only then
bugfix=root cause not symptom: report names a symptom → grep ALL callers, fix shared fn once. one guard there < one patch per caller; patching only ticket's named path leaves sibling caller broken

Rules:
- no unrequested abstractions (extraction threshold = SRP section below; this is the ladder's stance, that's the bar)
- no new dep if avoidable | no unrequested boilerplate
- deletion>addition, boring>clever, fewest files — applies to slice-internal impl only; FSD layer separation (entities/features/widgets/views) not negotiable under this rule
- shortest working diff wins, but only once understood — small diff in wrong place = not lazy, just a 2nd bug
- question complex requests: "need X, or does Y cover it?"
- same-size stdlib options → pick edge-case-correct one; lazy=less code, not weaker algorithm
- intentional shortcut → `ponytail:` comment; if it has a ceiling (global lock, O(n²), naive heuristic) name ceiling + upgrade path

NOT lazy about: understanding the problem first (trace flow before picking rung — an unread diff is laziness in disguise), input validation at trust boundaries, error handling preventing data loss, security, accessibility, real-hardware calibration (platform≠spec ideal: clock drifts, sensor reads off), anything explicitly requested.
non-trivial logic → leaves ONE runnable check behind (assert demo or small test file, no frameworks/fixtures); trivial one-liners need none.

## Project
Roastery management desktop app (like Cropster): roast profile logging, roast history tracking, green bean inventory management.

## Commands
- dev: `pnpm tauri dev` (desktop; vite:1420 + sidecar) | web-only `pnpm dev`
- build: `pnpm build` (frontend) | release `pnpm build:sidecar && pnpm tauri build` | local debug (macOS) `pnpm build:debug`
- test: `pnpm test` (vitest) | sidecar `pnpm verify:sidecar`
- lint: `pnpm check` (biome; CI gate) | `pnpm lint` (eslint, react-refresh)
- typecheck: `pnpm typecheck`
- verify: `pnpm verify:all` (check + typecheck + test + lint + sidecar) — run before push
- fix: `pnpm check:fix` | `types:gen` after DB schema migration

## Versioning
SSoT: `tauri.conf.json > version`. Bump all 3 atomically (`package.json`, `tauri.conf.json`, `Cargo.toml`):
```bash
pnpm version:bump <major.minor.patch>
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore(release): bump version to <version>"
git tag v<version>
git push origin main && git push origin v<version>
```
CI "Sync version across manifests" overwrites from tag — tag is final authority.

## Automation
| When | What runs | Auto-fix? |
|------|-----------|-----------|
| `git commit` | lint-staged → `biome check --write` on **staged files only** + secretlint | yes; lint-staged re-stages fixed files |
| `git push` | `pnpm verify:all` + `pnpm doctor:fast` | no |
| CI | typecheck, lint (biome), eslint, test, sidecar | no |
| repomix | manual — session start or large/structural change | — |

## External Services
- Supabase: BaaS — auth, DB (roast records, inventory), Edge Functions (R2 presigned URL issuer)
- R2: storage — roast profiles via presigned URL (upload/download issued by Supabase Edge Function; credentials never in client)
- Slack webhook: CI/CD notifications only (build/release success/failure)

## Security — Secrets
- NO `VITE_*` prefix for any secret → bundled into client JS, extractable. If found: rotate immediately, don't just remove
- R2/S3 from frontend: NO direct credentials → presigned URL only (issued by Edge Function)
- presigned URL: ≤5min expiry, scoped to single key, validate user ownership

# AGENT RULES
- When implementing/editing code: NO chat/greetings/summaries — output ONLY precise code diffs (modified lines only). (Reviews, evaluations, questions, and planning are exempt — answer normally.)
- repomix-output.xml: regenerate at session start and after large/structural changes (not every edit) via `rtk npx repomix --compress --remove-comments --remove-empty-lines --silent`.
- ALWAYS prefix all bash/shell commands with `rtk ` (e.g., `rtk ls`, `rtk git`, `rtk npm`).
- Commit: `git add` → `rtk gen-cmt` (no manual commit messages).
- [Exception] Omit `rtk ` prefix ONLY if output compression breaks error debugging.

## Tauri v2
- dev:1420 HMR:1421 | devUrl:localhost:1420 frontendDist:../dist
- perms: src-tauri/capabilities/default.json
- vite: ignore src-tauri/**

## Sidecar
- sidecar/server.py + drivers/ (MQTT,Modbus,Phidget,Roest)
- cfg: sidecar/config/devices/**/*.json

## UI
- views/: History,ActiveRoast | widgets/: modals,sidebar | shared/ui/: primitives


## Design
- shadow: multi-layer opacity<0.1, rgba(78,50,23,0.04)
- font: Waldenburg 300 heading / Inter +0.14px body
- NO emoji → Lucide | btn: radius:9999px
- vars: DESIGN.md | tw utility > style prop

## State
server data→ReactQuery | settings→TauriStore(LazyStore) | CRUD lists→Zustand+persist | session→Zustand

- Store: single settings.json, key=`domain.field`, singleton LazyStore, high-freq writes debounce 200ms+save(), localStorage fallback
- Zustand persist: key prefix=`fc_`, exclude fields→partialize, rehydrate→merge
- Zustand pure: src/shared/store/*.ts | entities/<slice>/model.ts | NO persist: auth, roast session, sensors

## Fetch
ReactQuery+axios | NO useEffect fetch

- api.ts: raw axios | queries.ts: reads | use<X>.ts: writes
- keyFactory: `{all, list(), detail(id)}`
- mutation→invalidateQueries | NO refetch()
- staleTime:Infinity(global) | axios singleton: shared/lib/axios.ts

## FSD
Unidirectional: shared → entities → features → widgets → views → app

### Hook segment naming (per slice)
model:domain logic/state(useAuth) | lib:pure infra util(useDebounce) | api:query/mutation wrap(useRoastQuery) | ui:render-only local state(useModalAnimation)
mismatch→move to correct segment

## SRP — all files (.ts/.tsx/.rs/.py)
check: count reasons-to-change → 1=OK, >1=split
size: >300L = re-check trigger, NOT the rule (50L file can still violate)

violations→split:
- fetch+transform+render in 1 fn → 3 fns
- hook w/ 2+ unrelated concerns (session+sensor) → 2 hooks
- file importing 2+ unrelated domains (entities/roast+entities/auth) → split/move to shared
- #[tauri::command] w/ inline multi-step orchestration → extract to domain fn, command=thin wrapper
- component: fetch+form state+render all inline → container/presentational split or extract hook
- views/*/components/* calling useQuery/useMutation/axios directly → move to entities or features

split naming: name=reason-to-change, NO utils.ts/helpers.ts

- extraction threshold (ladder rung 2 says reuse what exists; this is when NEW shared code is justified):
  - extract only if: 3+ occurrences + same reason-to-change + none of below
  - bad-abstraction signals (1+ → don't extract/revert):
    type-branching grows w/ callers | one caller's change leaks to others | boolean flag param (isX/mode) forks behavior | generic name (handleData/process/util) | can't explain "why same" in 1 sentence

### Layers
| Layer     | Purpose                                              | Key files                              |
|-----------|------------------------------------------------------|----------------------------------------|
| shared/   | Generic utils, UI primitives — zero domain knowledge | lib/, ui/, store/                      |
| entities/ | Domain models & server state                         | api.ts, queries.ts, model.ts, types.ts |
| features/ | Single user action (one feature = one mutation)      | use<Action>.ts, UI                     |
| widgets/  | Composed blocks from multiple features               | modals, sidebar                        |
| views/    | Orchestration only: compose widgets/features, no domain logic, no direct fetch | History.tsx, ActiveRoast.tsx |
| app/      | Providers, router, global config                     | —                                      |

### Rules
- Upper → lower import: FORBIDDEN
- entities ↔ entities direct import: FORBIDDEN (route through shared)
- features → features direct import: FORBIDDEN (compose in widgets/views)
- One slice = one responsibility; split if it grows


## Cross-Platform
- CI: macOS arm64 only | x86_64+Windows: release-time only → don't trust CI for OS bugs
- paths: pathlib.Path (py) / Tauri app.path() (rust) | NO hardcode `/`, `~/Library/...`, string-concat
- env: NO assume HOME exists (unset on Windows) → Path.home() / platform-safe API
- shortcuts: Tauri `mod+` notation only | NO hardcode Cmd+/Ctrl+
- UI: NO custom titlebar/tray/window chrome → native OS UI only
- sidecar/native deps: no Windows sidecar binary built yet → serial/socket/driver code NOT Unix-path-assuming

- before tag: PR touched sidecar or path logic → manual full-matrix build first
