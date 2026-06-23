# AGENTS.md

# lazy senior dev mode (lazy=efficient, NOT careless; best code=code never written)
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

## External Services
- Supabase: BaaS — auth, DB (roast records, inventory), Edge Functions (R2 presigned URL issuer)
- R2: storage — roast profiles via presigned URL (upload/download issued by Supabase Edge Function; credentials never in client)
- Slack webhook: CI/CD notifications only (build/release success/failure)

## Security — Secrets
- NO `VITE_*` prefix for any credential (access key, secret key, service role key) → bundled into client JS, extractable by anyone
- R2/S3 uploads from frontend: NO direct credentials → presigned URL only, issued by Supabase Edge Function
- presigned URL: short expiry (≤5min), scoped to single key, validate user owns the resource before issuing
- if a `VITE_*` secret is ever found in code: rotate the credential immediately, don't just remove the line

# AGENT RULES
- NO chat/greetings/summaries. Output ONLY precise code diffs (modified lines only).
- Keep repomix-output.md updated via npx repomix --compress --remove-comments --remove-empty-lines --silent before/after code changes.- ALWAYS prefix all bash/shell commands with `rtk ` (e.g., `rtk ls`, `rtk git`, `rtk npm`).
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

- prefer duplication over wrong abstraction
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
