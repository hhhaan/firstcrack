# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Tauri v2 Integration (Non-Standard)

- Frontend dev server fixed on localhost:1420 (vite.config.ts), HMR:1421
- Tauri devUrl: http://localhost:1420, frontendDist: ../dist
- Capabilities: src-tauri/capabilities/default.json (permissions)
- Ignore src-tauri/\*\* in Vite watch

## Python Sidecar (Device Layer)

- sidecar/server.py + drivers/ (MQTT, Modbus, Phidget, RoestSampleRoaster)
- Configs: sidecar/config/devices/_/_.json

## UI Structure

- src/views/: Page components (History.tsx, ActiveRoast.tsx)
- src/widgets/: Modals/sidebar (add-bean-modal/, active-roast/)
- src/shared/ui/: Reusable primitives (modal-shell/)

## Design Gotchas (DESIGN.md)

- Multi-layer low-opacity shadows (<0.1), warm-tinted (rgba(78,50,23,0.04))
- Headings: Waldenburg 300wt (light), Inter body +0.14px tracking
- No emojis (use Lucide icons), pill buttons (9999px radius)
- shadcn/ui theme vars in DESIGN.md
- Use tailwindcss utility classes instead of style prop

## State Management Strategy

**Decision tree:**
- 서버 데이터 → React Query
- 앱 설정 · 환경설정 (재시작 유지) → Tauri Store (`LazyStore`)
- 구조화된 엔티티 목록 (복잡한 로컬 CRUD) → Zustand + persist middleware
- 세션 임시 상태 → 순수 Zustand (no persist)

**Tauri Store — user preferences:**
- 모든 설정은 `settings.json` 하나에 집중. 키 형식: `domain.field` (`roast.settings`, `language` 등)
- 파일당 `LazyStore` 인스턴스 하나 (싱글턴). 여러 곳에서 `new LazyStore` 금지.
- 쓰기 고빈도 필드는 debounce 200ms 후 `store.save()`.
- Tauri 외 환경 대비 localStorage fallback 제공.

**Zustand persist middleware — entity lists:**
- localStorage 키는 `fc_` prefix (예: `fc_machines`)
- 저장 제외 필드는 `partialize`로 처리. hydration 시 재주입 필요 데이터는 `merge`에서 처리.

**Pure Zustand — ephemeral state:**
- 파일 위치: `src/shared/store/*.ts` (cross-cutting) 또는 `src/entities/<slice>/model.ts`
- auth(Supabase source of truth), 로스팅 세션, 라이브 센서 데이터는 persist 없이.

## Data Fetching Strategy

All server state is managed with **React Query + axios**. Never use `useEffect` to fetch data.

**Layer placement:**
- Raw axios calls → `entities/<slice>/api.ts`
- React Query hooks → `entities/<slice>/queries.ts` (reads) or `features/<slice>/model/use<Mutation>.ts` (writes)

**Query key factory** — every entity exports structured keys for predictable invalidation:
```ts
export const roastLogKeys = {
  all: ['roast-logs'] as const,
  list: () => [...roastLogKeys.all, 'list'] as const,
  detail: (id: string) => [...roastLogKeys.all, 'detail', id] as const,
}
```

**Mutation → invalidation rule** — after every mutation, use `queryClient.invalidateQueries`. Never call `refetch()` manually.
```ts
useMutation({
  mutationFn: saveRoastLog,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: roastLogKeys.list() }),
})
```

**staleTime** — global default is `staleTime: Infinity`. Data only refreshes on explicit invalidation. Override per-query only for real-time data (e.g., live hardware readings).

**axios singleton** — one instance at `src/shared/lib/axios.ts`. Never create a second `axios.create()`.

## No Tests/Linting

- No test framework or lint configs found
