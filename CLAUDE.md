
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
