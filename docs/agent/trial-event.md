# Event trial

`trial-event` is an explicitly assigned outreach entitlement. It has the same
feature and machine access as `tester`, with 100 Charges over 90 days
from its first assignment. The limits belong to the workspace owner and are shared
by members. Existing `trial` and `tester` accounts are not migrated.

## Enrollment and rollout

Release the migration and matching desktop version before enrolling accounts.
Using the authorized administrative database path, set the owner's
`profiles.plan` to `trial-event`. The AFTER trigger creates
`trial_event_grants` once, recording `started_at` and `ends_at`. The existing
billing-column guard prevents ordinary clients from assigning themselves access.
Changing the plan away and back does not restart the period or restore batches.
Earlier roast history does not consume the new allowance.

Polar remains the paid checkout/subscription path. Its existing entitlement
resolver upgrades `trial-event` on successful subscription events. Event trials
do not create a Polar subscription or require a payment method. No automatic
payment popup is included; existing plan settings and gate messages remain the
upgrade entry points. MCP write access also requires an active event grant; the
existing OAuth write scope and activation gates still apply. A future popup can use the grant's end date and counters.

## Batch and save behavior

During preheat/Charge wait, the desktop reserves a session UUID on the server.
Charge consumes the prepared UUID synchronously; it does not wait for network
authorization at the physical Charge event. Expiry prevents new Charges, while
an admitted batch can still save after expiry. Charge confirms usage asynchronously
using that UUID. Discarding after Charge never refunds it, and Cancel Drop resumes
the same charged batch without consuming another use. Summary discard is a
synchronous local action, so it cannot race a refund against Save or Cancel Drop.
Only unused preparations are released. A refused preparation retries when refreshed
capacity increases, without releasing/re-reserving its own final slot.

The server locks the owner's grant for reservation, Charge, completion and release.
Used and reserved batches together cannot exceed 100. Charge converts one
reservation to one used batch; save records completion without charging again.
If save beats a delayed Charge acknowledgement, its transaction finalizes the
reservation instead. Rollback and retries never double-charge, and release ignores
charged/completed UUIDs. The private ledger has no session FK, so deleting saved
history never refunds use. Supported legacy/import saves without a
reservation count only while the grant is active and has capacity.

The last admitted save may finish its atomic stock writes, curve path upload and
derived plan completion after the limit. Ordinary later edits remain gated.
Existing records stay readable.

Reservations deliberately do not expire automatically: a disconnected device may
have charged already, even without a saved roast. Charge retries transport failures;
if acknowledgement remains unavailable, the reservation still occupies capacity
and saving can finalize it. Admission includes these occupied reservations even
before the server can confirm them as used.
A crash before Charge/cleanup can also leave an unused reservation. Support must
confirm that Charge never occurred, including checking running sessions, pending
saves and discarded roasts, before returning that exact reservation through
`release_trial_event_batch(owner_id, session_id)` in the affected user's authorized
session. A missing saved roast alone is not proof of an unused reservation. Never
reset `used_batches` or delete the grant to recover a reservation.

## Verification and deployment boundary

`supabase/tests/trial-event.test.ts` applies the actual gate/entitlement migrations
to `trial-event-fixture.sql` using pinned PGlite 0.3.14. It covers enrollment,
workspace permissions, blocked client entitlement edits, reservation/retry/
rollback, the final batch after expiry, stock/progress/curve completion, deletion,
legacy plans and the actual Polar resolver. The billing CI workflow runs it.
Frontend tests cover feature parity, separate counts, synchronous Charge,
workspace switches, expiry, Cancel Drop, synchronous discard and capacity retry.
PGlite is not a multi-connection
concurrency stress test or a replay against the full production schema.

2026-11-05 (KST): Core verification, frontend build, lint and isolated SQL tests ran in
the implementation workspace. The required Docker-backed local reset could not
run: the default ECR registry was inaccessible and the official GHCR image failed
to unpack because the Docker host ran out of space. Automatic approval review
also declined a broad read-only export of hosted schema metadata. No production
schema or accounts were changed. Public TypeScript additions were checked against
the isolated SQL catalog; full local type generation remains pending. The draft
PR records this outstanding validation. Before marking it ready or releasing,
complete the local reset/type generation described in
`supabase/AGENTS.md`, accounting for the historical bootstrap gap documented in
`active-roast-save.md`.
