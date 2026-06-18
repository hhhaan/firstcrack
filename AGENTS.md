# AGENTS.md

# AGENT RULES
- NO chat/greetings/summaries. Output ONLY precise code diffs (modified lines only).
- Keep `repomix-output.txt` updated via `rtk repomix --silent` before/after code changes.
- ALWAYS prefix all bash/shell commands with `rtk ` (e.g., `rtk ls`, `rtk git`, `rtk npm`).
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

### Layers
| Layer     | Purpose                                              | Key files                              |
|-----------|------------------------------------------------------|----------------------------------------|
| shared/   | Generic utils, UI primitives — zero domain knowledge | lib/, ui/, store/                      |
| entities/ | Domain models & server state                         | api.ts, queries.ts, model.ts, types.ts |
| features/ | Single user action (one feature = one mutation)      | use<Action>.ts, UI                     |
| widgets/  | Composed blocks from multiple features               | modals, sidebar                        |
| views/    | Page-level composition only                          | History.tsx, ActiveRoast.tsx           |
| app/      | Providers, router, global config                     | —                                      |

### Rules
- Upper → lower import: FORBIDDEN
- entities ↔ entities direct import: FORBIDDEN (route through shared)
- features → features direct import: FORBIDDEN (compose in widgets/views)
- One slice = one responsibility; split if it grows

## Rules
- export: named only (NO default)
- NO test/lint



