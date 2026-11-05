# Charge usage and event trial

Every plan counts one physical Charge as one use. Save, discard and Cancel Drop
never refund or add another use. Limits belong to the workspace owner and are
shared by members.

| Plan | Allowance | Window |
| --- | --- | --- |
| `trial` | 20 Charges | 14 days from signup; lifetime usage |
| `trial-event` | 100 Charges | 90 days from the first explicit grant |
| `pro`, legacy `free` | 200 Charges | UTC calendar month |
| `tester`, `pro_plus`, `enterprise`, legacy `team` | Unlimited | Charge totals are recorded by UTC month |
| `read_only` | No new Charge | Existing records remain readable |

The migration seeds the private usage ledger from existing completed history.
Ordinary trial and monthly usage do not reset at rollout. Undated history counts
for lifetime usage only, matching its previous exclusion from monthly counts.
Historical discarded Charges cannot be reconstructed. Event grants exclude all
pre-enrollment history and are not renewed by switching plans away and back.

## Event enrollment and rollout

`trial-event` has the same desktop features and machine access as `tester`.
Release the migration and matching desktop version before enrolling accounts.
Through the authorized administrative database path, set the owner's
`profiles.plan` to `trial-event`. The AFTER trigger creates `trial_event_grants`
once with its start/end dates. Existing trial/tester accounts keep their plan.
Clients cannot assign themselves access or edit the allowance.

Polar remains the paid checkout/subscription path and upgrades event trials on
successful subscription events. Event trials need no payment method or Polar
subscription. No automatic payment popup is included. MCP write access still
requires its existing scope/activation checks and an active event grant.

## Admission and recording

Capped accounts reserve a session UUID during preheat/Charge wait. Charge takes
that UUID synchronously and starts local recording without waiting for a network
response. Preparation is scoped to owner, plan and period. A UTC month rollover
refreshes usage and replaces an unused prior-period preparation. Trial expiry
prevents new Charges; it does not restart a trial.

Authorized unlimited accounts need no network preparation. All accounts write a
small durable Charge outbox entry after the running session starts. The app's
recovery widget submits it, retrying after reconnection/remount for the active
workspace. Leaving the roast view or discarding its summary does not discard the
usage entry. Storage failures preserve an in-memory entry and report the error
without interrupting physical recording; a forced exit during such a storage
failure cannot guarantee recovery. Revoked access leaves the entry pending.

The server serializes admissions, Charge acknowledgements, saves and unused
releases with the owner's profile row lock. The session UUID deduplicates every
request. Used and held slots cannot exceed a capped plan's allowance. Prepared
Charges belong to their admitted period even if acknowledged/saved after expiry
or midnight. Unlimited offline Charges retain their occurrence month.

Saving only records completion. If it arrives before the Charge acknowledgement,
it settles that same reservation; the later acknowledgement is a no-op. Legacy
and import clients without admission count their first completed save as a
compatibility Charge, only while active and below the cap. Retrying, rolling back
or deleting saved history never creates/refunds usage. History lists, batch
numbering and inventory still describe saved records, independently of billing.

The final admitted roast can complete its atomic stock writes, curve upload and
derived plan progress after the cap or trial expiry. The monthly roast cap does
not freeze unrelated inventory writes. Summary discard is synchronous and has no
network refund step, so Save/Cancel Drop cannot race a returned allowance.

For trial plans, a reserved/charged admission less than 24 hours old also permits
day-plan and plan-batch writes after the cap or expiry. This lets summary/recovery
materialize a recurring occurrence before the session save. The grace deliberately
allows other schedule edits during that window; it ends when no recent unfinished
admission remains. It does not allow new Charges, unrelated inventory/history edits,
MCP writes or writes for an explicitly `read_only` owner. Workspace ownership checks
still apply. Strict save-only enforcement can replace this with a dedicated RPC later.

## Unused preparations

Only preparations that never reached Charge may be returned with
`release_roast_charge(owner_id, session_id)` in an authorized user session.
Refused preparation retries when refreshed available capacity increases, without
cycling its own last slot. Charged/completed UUIDs ignore release requests.
After transport/5xx retries are exhausted, preparation retries the same UUID on
reconnection or after five seconds. It keeps that uncertain reservation until
success or leaving the admission scope, so a lost response cannot reserve twice.

Reservations deliberately do not expire automatically. A disconnected device may
have charged even without a saved roast. Support must check the running session,
Charge outbox, pending saves and discarded roasts before returning an orphaned
preparation. A missing saved record alone is not proof that Charge never occurred.
Never reset grant counters or delete the usage ledger to recover a preparation.

## Verification and deployment boundary

`supabase/tests/trial-event.test.ts` uses pinned PGlite 0.3.14 with the real gates
and Polar resolver on `trial-event-fixture.sql`. It covers baseline preservation,
workspace isolation, trial/event/monthly caps, unlimited plans, discard, retries,
rollback, late saves, stock/progress/upload, deletion and billing transitions.

`python3 supabase/tests/roast-charge-concurrency.py <fresh-postgres-container>`
applies that isolated schema to a disposable PostgreSQL 15 container. Eight
concurrent admissions compete for the last slot of trial, event and Pro accounts;
eight duplicate Charge/save requests still count once. An unlimited account also
counts eight concurrent acknowledgements of the same UUID only once.
Frontend tests cover synchronous Charge, preparation ownership/expiry/rollover,
Cancel Drop, discard, outbox persistence/reconnect and workspace switches.

2026-11-05: Isolated SQL and PostgreSQL 15 concurrency checks passed. The complete
Supabase local reset and full local type generation remain outstanding: the
repository's historical bootstrap omits its initial public tables (see
`active-roast-save.md`). An earlier Supabase stack attempt also failed to unpack
its image due to Docker host space, and automatic approval review declined a
broad hosted-schema export. The isolated schema is not a substitute for the real
pre-change schema. Public RPC types are checked against the isolated catalog.
No production schema or user plans were changed. Complete the local reset/type
generation required by `supabase/AGENTS.md` before release.

2026-11-06: Recovery/grace regressions passed in PGlite, alongside 54 related
frontend tests, type checks and changed-file Biome checks. Node 26 tests used
`NODE_OPTIONS=--no-experimental-webstorage` for jsdom storage. The local reset
could not run because Docker was stopped; full-schema validation remains pending.
