
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
