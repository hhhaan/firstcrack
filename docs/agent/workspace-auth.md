# Workspace identity & auth (agent)

**Audience:** coding agents  
**Date:** 2026-07-21  
**Note:** `docs/team-workspaces.md` is a **stale Korean design** (header still says pre-implementation). Prefer this file + live code.

---

## Purpose

Multi-seat teams share the **owner account's data**. There is no `org_id` column on domain tables. Access is RLS `has_workspace_access(target_owner)` + client queries keyed by **workspace owner id**.

---

## Primary trees

| Concern | Path |
|---------|------|
| Auth session store | `src/shared/store/auth.ts` |
| Workspace store | `src/shared/store/workspace.ts` (`fc_workspace` persist; `activeOwnerId`) |
| Resolve owner id | `resolveWorkspaceOwnerId` in workspace store; **`useActiveWorkspace`** in `src/entities/organization/model.ts` |
| Memberships API/queries | `src/entities/organization/api.ts`, `queries.ts`, `types.ts` |
| Team invite | `src/features/team-invite/` |
| Login / OAuth | `src/features/auth/`, `src/views/login/Login.tsx` |
| DB | migrations `*workspaces*`, `workspace_security`, org role/directory |

---

## Mental model

```
auth.user.id          = who is logged in
workspaceOwnerId      = whose data we read/write (self or team owner)
activeOwnerId (store) = null ⇒ self; else selected owner (must be in memberships)
```

`resolveWorkspaceOwnerId(active, auth, membershipOwnerIds)`:

- null/self → auth user
- foreign id in memberships → that owner
- foreign id not in memberships → fall back to self

`useActiveWorkspace` **blocks** foreign workspace until memberships load (`workspaceOwnerId === ''`) to avoid a flash of personal data / wrong writes.

```ts
const { workspaceOwnerId, isWorkspaceReady, isForeignWorkspace, authUserId } = useActiveWorkspace();
// queries: useX(isWorkspaceReady ? workspaceOwnerId : '')
// mutations: if (!isWorkspaceReady || !workspaceOwnerId) throw ...
```

---

## Write identity invariants

1. **All domain rows** (`user_id`) stay owned by the workspace owner — members write owner rows through RLS, not their own personal copy.
2. **Never** use `auth.user.id` alone for list filters / inserts when a foreign workspace can be active — use `workspaceOwnerId`.
3. **Gate** mutations on `isWorkspaceReady` (see `useFulfillOrder`, `useCancelOrder`, roast save flow).
4. **Host plan** for feature gates on foreign workspaces comes from membership `owner_plan` hydrated into `ownerPlanById` (not the member's personal plan).
5. **Session termination** outside protected machine work clears auth state and the profile plan cache without inferring the cause. Preserve workspace selection; auth regression tests live in `src/shared/store/auth.test.ts`.

---

## Team invite flow

- Features under `src/features/team-invite/` create/redeem/remove invites.
- Tokens are copy/paste style (similar precedent: cupping invites) — no email sender required in desktop path.
- Org tables: `organizations`, `organization_members`, `organization_invites` (see migrations).

Owner: one org per owner (`organizations.owner_id` unique). Plan SSoT remains `profiles.plan` (billing columns client-frozen — see `supabase/AGENTS.md`).

---

## Secrets

- No secrets in `VITE_*` (bundled).
- Supabase anon key is public by design; service role never in client.
- OAuth deep link: `src/features/auth/` — keep redirect handling platform-safe.

## Authentication loss during machine work

`AppShell` binds `protectRoastSession` before initializing auth. Its synchronous
roast-store subscription protects every non-idle phase, a connected/reconnecting
machine, and a PID that is not off. Auth loss retains the local operator identity,
workspace and cached plan with `reauthenticationRequired`; the same screen, polling,
TSV writer and controllers remain mounted. Manual sign-out is blocked at both the
button and store action, including the race where machine work starts during a
pending sign-out. A different account cannot replace the local operator while protected.

This does not extend cloud credentials or bypass RLS. Existing roast-save checkpoints
retain failed cloud saves. Same-account session recovery clears the notice without
clearing the plan cache. Otherwise, login is required once the operator finishes and
disconnects the machine. Intentional sign-out uses local scope so another device's
roast is not signed out. Regression: `auth.test.ts` and
`e2e/tests/roast-auth-continuity.spec.ts` (real auth refresh refusal, live collection,
TSV writes, subsequent Replay steps and manual control through a mocked roaster).

---

## Agent do / don't

**Do**

- Call `useActiveWorkspace` (or pass `workspaceOwnerId` from a parent that did)
- Invalidate query keys built with the **same** owner id used for the write

**Don't**

- Add `org_id` columns "for clarity" without an explicit migration program
- Fall back to auth user while `activeOwnerId` is foreign and memberships still loading
- Trust stale `docs/team-workspaces.md` status line ("not implemented")
