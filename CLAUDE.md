
## Project Architecture (FSD)

This project follows Feature-Slice Design. Layers import only from layers below:
```
views → widgets → features → entities → shared
```

Never import from the same layer across slices (e.g., one entity importing another entity directly). Always go through the slice's public API (`index.ts`).

Layer responsibilities:
- **shared** — reusable UI, utilities, types, i18n, Zustand stores (no business logic)
- **entities** — domain objects: `api.ts` (Supabase calls), `queries.ts` (React Query hooks), `index.ts`
- **features** — user-facing behaviors: `lib/` (pure logic), `model/` (hooks + state), `index.ts`
- **widgets** — composite UI sections: `ui/` (components + co-located hooks), `index.ts`
- **views** — page-level: one component + `hooks/` subdirectory for complex pages

## SRP and Hook Separation

Every custom hook lives in its own file. Never define a hook inline inside a component file.

Split hooks by responsibility — one hook, one job:
- Data fetching / React Query → `entities/*/queries.ts` or `features/*/model/use*.ts`
- Derived UI state, local state → a dedicated `use*.ts` next to the component
- Side effects (keyboard shortcuts, polling, subscriptions) → separate `use*.ts`

Components only call hooks and return JSX. If a component has more than one `useState`/`useEffect` concern, extract each into its own hook.

Hook file placement:
- features: `src/features/<slice>/model/use*.ts`
- widgets: `src/widgets/<slice>/ui/use*.ts` (co-located with the component)
- views: `src/views/<page>/hooks/use*.ts` (use `hooks/` subdir when a page has multiple hooks)

## State Management Strategy

### Decision tree — what to use

| 데이터 성격 | 도구 |
|---|---|
| 서버 데이터 (DB 읽기/쓰기) | React Query |
| 앱 설정 · 사용자 환경설정 (앱 재시작 후에도 유지) | Tauri Store (`LazyStore`) |
| 구조화된 엔티티 목록 (복잡한 로컬 CRUD) | Zustand + persist middleware |
| 세션 중 임시 상태 (로스팅 진행, auth, 라이브 데이터) | 순수 Zustand (no persist) |

### Tauri Store — user preferences & settings

앱 설정, 환경설정처럼 앱 재시작 후에도 살아남아야 하는 key-value 데이터.

```ts
// src/shared/lib/myStore.ts
import { LazyStore } from '@tauri-apps/plugin-store'

const store = new LazyStore('settings.json')   // 모든 설정은 settings.json 하나에 집중

export const myStore = {
  get: () => store.get<MyType>('my.key'),
  set: (val: MyType) => store.set('my.key', val).then(() => store.save()),
}
```

**규칙:**
- 파일 하나에 `LazyStore` 인스턴스 하나 (싱글턴). 여러 곳에서 `new LazyStore` 금지.
- 스토어 파일은 `settings.json` 하나에 집중. 키는 `domain.field` 형식 (`roast.settings`, `roastery.location`, `language`).
- 쓰기 고빈도 필드(차트 설정 등)는 debounce 200ms 후 `store.save()`.
- Tauri 환경이 아닌 경우(개발 웹)를 위해 localStorage fallback 제공.

### Zustand persist middleware — structured entity lists

앱 재시작 후에도 필요하지만 단순 key-value가 아닌 구조화된 목록 (예: 머신 목록).

```ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export const useMachinesStore = create<MachinesState>()(
  persist(
    (set) => ({ ... }),
    {
      name: 'fc_machines',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ machines: s.machines.filter(m => !m.isVirtual) }),
      merge: (persisted, current) => ({ ...current, machines: [...virtualMachines, ...(persisted as MachinesState).machines] }),
    }
  )
)
```

**규칙:**
- localStorage 키는 `fc_` prefix (`fc_machines`, `fc_*`).
- 스토어에서 persist에 저장하지 않을 필드는 `partialize`로 제외.
- hydration 시점에 재주입이 필요한 파생 데이터(virtual 항목 등)는 `merge`에서 처리.

### Pure Zustand — ephemeral session state

서버가 source of truth이거나 앱 재시작 시 초기화되어야 하는 상태.

```ts
// auth: Supabase가 source of truth → persist 불필요
// roasting: 진행 중 세션 → 앱 재시작 시 초기화가 맞음
// live data: 하드웨어에서 실시간 수신 → 저장 불필요
```

**규칙:**
- 스토어 파일 위치: `src/shared/store/*.ts` (cross-cutting) 또는 `src/entities/<slice>/model.ts` (entity-scoped).
- 스토어 하나에 단일 도메인만. 여러 도메인이 섞이면 파일 분리.

## Data Fetching Strategy

All server state is managed with **React Query + axios**. Never use `useEffect` to fetch data.

### Layer placement
- Raw axios calls → `entities/<slice>/api.ts`
- React Query hooks → `entities/<slice>/queries.ts` (reads) or `features/<slice>/model/use<Mutation>.ts` (writes)

### Query key factory
Every entity exports a key factory so invalidation is predictable:

```ts
// entities/roast-log/queries.ts
export const roastLogKeys = {
  all: ['roast-logs'] as const,
  list: () => [...roastLogKeys.all, 'list'] as const,
  detail: (id: string) => [...roastLogKeys.all, 'detail', id] as const,
}
```

### Mutation → invalidation rule
After every mutation, invalidate via `queryClient.invalidateQueries`. Never call `refetch()` manually or re-trigger queries in `useEffect`.

```ts
useMutation({
  mutationFn: saveRoastLog,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: roastLogKeys.list() })
  },
})
```

### staleTime
Global default is `staleTime: Infinity` (set in QueryClient). Data only refreshes on explicit invalidation — no silent background refetches. Override per-query only when real-time freshness is required (e.g., live hardware readings).

### axios singleton
One axios instance lives at `src/shared/lib/axios.ts` with `baseURL` and auth interceptors. Never create a second `axios.create()` elsewhere.

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

## Dark Mode Border Rules

- 다크모드 모든 컴포넌트 구분선(border) 색상은 `#585d61`로 통일한다.
  - 예시: `dark:border-[#585d61]`, `dark:border-r-[#585d61]`, `dark:border-t-[#585d61]` 등
  - 라이트모드는 CSS 변수(`--color-border`, `--color-divider`, `--color-border-subtle`)를 그대로 사용한다.
- 다크모드에서는 **모든 카드/컴포넌트에 반드시 border가 있어야 한다**.
  - `dark:border dark:border-[#585d61]` — full border가 기본
  - 구분선(divider) 역할일 때는 방향에 맞게 `dark:border-b-[#585d61]`, `dark:border-t-[#585d61]` 등 사용
- 라이트모드든 다크모드든 항상 양쪽 모드를 명시적으로 지정한다. (`border-border` + `dark:border-[#585d61]`)

## Surface CSS Variables (Dark Mode)

- `--color-surface-elevated: #262b30` — 컴포넌트 내부 배경이 메인 배경(`#181d21`)보다 한 톤 밝아야 할 때 사용.
  - Tailwind: `bg-surface-elevated`
  - 사용처: 서치 박스, 필터 드롭다운, select 등 입력/선택 컴포넌트의 배경
  - 기본 원칙: 대부분의 카드는 `bg-main-bg` + `dark:border dark:border-[#585d61]` 조합으로 가고, 내부 입력 요소에만 `bg-surface-elevated` 사용
- 라이트모드에서는 `--color-surface-elevated`가 `--color-surface`(#efeff0)와 동일하므로, `bg-surface-elevated`는 라이트모드에서 `bg-surface`와 같은 색상으로 보임.

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
