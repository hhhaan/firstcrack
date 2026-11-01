# MCP inventory and production writes

Deployed on 2026-11-01 after the user's explicit deployment instruction. All three
write flags are enabled. Existing read connections remain read-only and need fresh
explicit write consent. Production inventory was not changed for testing.
See [firstcrack-mcp.md](firstcrack-mcp.md) for the existing opaque-token boundary.

## Tools

All writes require a UUID `request_id` and a nonempty `reason` (maximum 500 characters).
Weights are integer grams; quantities are integer finished-product units. Values are
bounded to one billion. Arguments are strict: owner IDs, SQL and extra fields are rejected.

| Tool | Arguments beyond request ID and reason | Effect |
| --- | --- | --- |
| `receive_green_stock` | `bean_id`, `quantity_g`, optional `unit_cost_per_kg` | Purchase event for an existing bean |
| `adjust_green_stock` | `bean_id`, `delta_g` | Signed green-stock adjustment |
| `adjust_roasted_stock` | `bean_id`, `delta_g` | Signed single-bean bulk-roasted adjustment |
| `adjust_product_stock` | `product_id`, `delta` | Signed finished-product adjustment |
| `record_roast_production` | `production_id`, `bean_id`, `input_weight_g`, `output_weight_g`, `roasted_at` | `save_roast_op`: session, green debit and measured bulk inbound in one transaction |
| `record_packaging_production` | `production_id`, `product_id`, `quantity`, `packaged_at` | `insert_packaging_op`: product inbound and bulk debit using the current product specification |

Timestamps require a timezone. Output cannot exceed roast input. Packaging derives its
bean/blend and grams per unit from the workspace's active product; the caller cannot
substitute them. Non-coffee products have no bulk debit. These tools do not create bean
or product definitions, edit orders/payments, blend green coffee or control hardware.

## Consent and database boundary

- Required read scope: `firstcrack:read`. Optional additional scope: `firstcrack:write`.
  The only stored combinations are read alone or `firstcrack:read firstcrack:write`.
- Flags default off: Edge `FIRSTCRACK_MCP_WRITE_ENABLED`, issuer
  `FIRSTCRACK_OAUTH_WRITE_ENABLED`, landing `MCP_OAUTH_WRITE_ENABLED`.
- New authorization must request write scope. The consent checkbox starts unchecked.
  An unchecked approval grants read alone; checking a read-only request cannot expand it.
  Refresh cannot expand scope. Existing write grants can still refresh for reads when
  write flags are disabled; tool execution remains blocked by the Edge write gate.
- The opaque grant fixes actor, client and workspace. Every write revalidates revocation,
  expiry, enabled client, current membership and owner plan before any receipt lookup.
  Inventory writes require `pro_plus`, `enterprise`, `team` or `tester`, matching the
  inventory feature gate; `pro` read connections remain supported.
- Gateway credentials can execute the fixed private dispatcher only. The new NOLOGIN,
  NOBYPASSRLS writer owns no customer tables, has no authenticated/service-role membership,
  and receives inventory-specific grants with selected-workspace RLS. Existing read
  roles, OAuth clients and `profiles` policies are preserved.
- Hosted Supabase does not let `postgres` grant custom roles access to the managed Auth
  schema. `public.request_user_id()` uses the exact live `auth.uid()` claim expression
  as a STABLE INVOKER function. The existing roast RPCs keep their owner, ACL, config
  and INVOKER mode; only their four actor lookups use this function. The writer has
  no Auth-schema USAGE or native-role membership. The generated public type includes
  this helper.

## Atomicity, concurrency and audit

`private.mcp_write_requests` permanently binds a successful request ID to its tool,
arguments, result, actor and client. Retry uncertain outcomes with exactly the same ID
and arguments. Failed operations create no receipt. Reusing an ID with changed arguments
fails. Receipts are independent of OAuth grant and production-record lifetimes.

For roasts, `production_id` is the app's `roast_sessions.id`. For packaging it is the
app operation UUID stored in both ledger `reference_id` fields. Permanent
`private.inventory_productions` receipts reserve production UUIDs globally, backfill existing sessions/production events
and register future app and MCP production. A new request ID or deletion of a source
session/ledger row cannot free a production ID. A different request using an existing
production ID fails with `production_exists`; it does not claim another successful write.
The dispatcher also verifies that the production was created by its own transaction
when an app save races on the same session ID.

Different production IDs for the same physical production cannot be recognized
automatically. The caller must reuse the real app production ID and avoid registering
an already-recorded physical batch under a different ID. Preexisting records deleted
before this migration cannot be reconstructed from the remaining database.

All three ledgers share a workspace advisory transaction lock, acquired with
`pg_try_advisory_xact_lock`. Busy operations fail with retryable `inventory_busy`;
they never wait on this lock while holding existing order, catalog, session or counter
row locks. This avoids introducing advisory/row-lock inversions into app RPCs.
Different workspaces proceed independently (a hash collision can cause contention only).
The guard requires READ COMMITTED so checks use fresh committed balances.

BEFORE ROW guards validate reference ownership and acquire the lock. AFTER STATEMENT
transition tables check actual negative net deltas, covering inserts, updates, deletions
and source moves while preserving conflict no-ops and positive repairs of old negative
balances. An insufficient balance rolls back the entire production transaction and its
receipts. Corrections or deletions that would create a negative balance now fail too.

## Verification and activation

The targeted runner is `bash supabase/tests/test-mcp-inventory.sh`. It creates its own
disposable PostgreSQL database with fixture identity/schema, current app RPCs, actual
issuer/write migrations and RLS. It does not prove the full Supabase migration chain,
extensions, real hosted Auth or a real ChatGPT connection.

Full-chain validation remains mandatory before commit: confirm local project/ports,
`supabase start`, `supabase db reset --local`, then generate local types using
`supabase gen types typescript --local` and `node scripts/append-db-aliases.mjs`.
Never use `--linked` for reset. Do not overwrite generated types on a failed generator.
On this machine the Supabase CLI is run with the installed Node 24 runtime because
the system Node executable currently fails to load its simdjson library.

On 2026-11-01, the required PG15 image was already cached, so no denied download was
retried. `supabase start` failed before the new migration at
`20260510200500_enable_rls.sql`: `relation "public.beans" does not exist`.
Earlier baseline migrations are placeholders. A complete, reviewed local bootstrap
baseline is needed; do not invent it or replace historical migrations to manufacture a
green check. The original historical-chain replay remains blocked.

The approved deployment also used a schema-only export of the actual deployed database
in a separate local Supabase project. Full local startup and confirmed `db reset --local`
passed there. Direct schema restore retained the deployed owners, triggers and RLS.
The new migration and its actor-lookup correction passed against that schema without
granting the writer Auth-schema access. Local type generation passed. This is not a claim
that the repository's incomplete historical baseline replays.

Deployment sequence for future approved releases:

1. Review and apply `20261101051354_mcp_inventory_production_write.sql` through the normal
   migration path. Do not reapply `20261031105609`; its profile policy fix is already
   reported applied and its existing USING condition must stay unchanged.
2. Deploy issuer and MCP Edge code with write flags off; retain existing restricted
   server credentials and handler authentication (`verify_jwt=false`). No credential
   gains writer-role membership. Include the MCP function's pinned Deno import map.
3. Deploy the landing consent/connections changes with its write flag off.
4. Update the existing plugin's tool definitions/discovery and requested OAuth scopes.
   Do not publish or expand OAuth permissions without approval.
5. Enable the write flags for the approved test, obtain fresh explicit write consent,
   and use only a separately approved test workspace, target and quantities. Check
   successful writes, retries, refusal paths, reads and desktop coexistence before rollout.

Rollback: disable `FIRSTCRACK_MCP_WRITE_ENABLED` first, then disable new issuer/landing
write consent, revoke write grants and restore read-only plugin configuration. Existing
read grants continue to work. Roll back Edge/landing releases only after requests stop.
Keep permanent audit/production receipts, stock guards and RLS; never undo a committed
stock event by deleting the audit trail or dropping deduplication tables. Any stock
compensation or database rollback needs its own reviewed operation and approval.

## Final verification on 2026-11-01

| Check | Result |
| --- | --- |
| `pnpm exec vitest run supabase/functions` | Passed, 363 tests in 35 files |
| `MCP_TEST_LANDING_ROOT=/path/to/fc-landing-mcp-write bash supabase/tests/test-mcp-inventory.sh` | Passed, 122 SQL assertions and 22 cross-repository HTTP assertions |
| `MCP_TEST_LANDING_ROOT=/path/to/fc-landing-mcp-write bash supabase/tests/test-mcp-opaque.sh` | Passed, 127 OAuth, native-identity and MCP SDK assertions |
| Landing `pnpm --filter @fc/landing test:mcp` | Passed, 29 tests |
| Landing `pnpm build:landing` with fixture public bindings | Passed, existing Cloudflare adapter warnings |
| Desktop `pnpm typecheck` | Passed, all three TypeScript configurations |
| Deno checks with the MCP function's `deno.json` | Passed, both Edge entrypoints and inventory integration files |
| Biome on changed MCP files, migration RLS checker, shell syntax and diff whitespace | Passed |
| Biome on the broader existing OAuth directory | Failed, unchanged `client-auth.test.ts` formatting |
| Full local `supabase start` | Failed before new code, missing `public.beans` at `20260510200500_enable_rls.sql` |
| Actual deployed-schema local Supabase reset, RPC runtime and local types | Passed, including real batch-counter and native authenticated RPC behavior |
| Hosted deployment, public discovery and existing ChatGPT reads | Passed; issuer and resource advertise both scopes, existing grant scopes stayed read-only |
| Real ChatGPT writes and operational inventory changes | Not run; require fresh consent and approved test targets and quantities |

Concurrency checks cover app/MCP 700 g deductions against 1,000 g, MCP/MCP production,
native order fulfillment against a held inventory lock, and an app session save with no
ledger effects racing the same MCP production ID. The first case leaves 300 g. Order
contention returns `40001` without changing stock or `fulfilled_at`, then succeeds after
the lock is released. Actual HTTP receiving and same-ID retry increase stock by exactly
10 g. Tests also cover packaging failure, source deletion, strict SQL input validation,
expected-inbound exclusion, positive repairs and event reclassification.

Independent source review found no remaining blocking defect. Comment review inspected
11 added comments and requested no deletions, restorations, fixes or constraint encodings.
These reviews do not replace a full deployed-schema replay. Fixture tables, Auth and
extensions remain simplified; the fixture does not load the app batch-counter trigger.

Firstcrack changes are on `feat/mcp-inventory-production-write`. Landing changes are in
the separate `fc-landing-mcp-write` worktree on `feat/mcp-inventory-production-consent`.
Both remain uncommitted while the original historical baseline remains incomplete.
No push, PR or merge was performed. The user separately authorized deployment from the
reviewed source artifacts.

Production migration history is `20261101051354_mcp_inventory_production_write` and the
source filename matches it. The preexisting `20261031105609` policy migration was not
reapplied. After flag activation, Edge releases are issuer version 12 and MCP version 10
with the same verified source hashes. Landing deployment is
`93831c42-2230-4f7f-a18b-a33961c41253` at `firstcrackiscoming.com`.
The final bundle SHA-256 is `f373d1e5daf91bd3e1b204350d9131292f5c750558bf30060fbd766a8cbb7096`.
All previous Pages bindings were preserved; only the new write flag was added.

The actual well-known issuer route initially omitted the write flag. It now passes a
required proxy configuration field. Both public issuer metadata routes and the MCP
resource metadata return read and write scopes. The unrelated sample-only
`firstcrack-test` plugin was not edited. The live MCP connection uses server discovery;
existing users must reconnect with the additional scope and check the new write consent.

The implementation files are:

- `supabase/functions/firstcrack-mcp/{auth,server,write}.ts` and `deno.json`.
- `supabase/functions/firstcrack-mcp/write.test.ts`.
- `supabase/functions/_shared/mcp-oauth/{access,config,http,postgres,service}.ts`.
- `supabase/functions/_shared/mcp-oauth/{access,write}.test.ts`.
- `supabase/migrations/20261101051354_mcp_inventory_production_write.sql`.
- `supabase/tests/mcp-inventory-{fixture.sql,http.ts}`, `mcp-inventory.integration.ts`
  and `test-mcp-inventory.sh`; the old opaque integration explicitly uses the read-only flag.
- `src/shared/types/database.types.ts` contains the generated actor-helper signature.
- `supabase/AGENTS.md` and the two MCP agent documents.
- Landing `astro.config.mjs`, `mcpConnections.ts`, `mcpConsent.ts`, `mcpIssuer.ts`,
  consent/connections pages, OAuth proxy and well-known issuer routes, their two controller tests and
  `docs/mcp-consent.md`.

Unrelated updater and workflow edits in the shared firstcrack working tree are preserved.
