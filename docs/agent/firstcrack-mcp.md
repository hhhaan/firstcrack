# FirstCrack MCP: independent OAuth issuer

Status (2026-10-26): read-only issuer SQL is migration
`20261026120000_firstcrack_mcp_read_issuer.sql`. It is not applied until Deploy
migrations runs. Both Edge functions stay disabled until their flags and database
URLs are set as secrets. No LOGIN passwords, OAuth client rows, or hosted deploys
are in this change.

## Credential boundary

The external client receives **opaque MCP credentials**, never a native Supabase access
or refresh token. Native tokens remain blocked as MCP credentials; the landing helper
`decideNativeConsent` still refuses native OAuth approval regardless of feature flags.
Supabase custom scopes are not supported by its native OAuth server; `firstcrack:read`
is supported by **this independent issuer**, not by enabling that Supabase feature.

This is a separate logical authorization server on existing hosting, not a new hosting
project. The selected source design uses:

| Public endpoint | Existing hosting / implementation |
| --- | --- |
| `https://firstcrackiscoming.com/.well-known/oauth-authorization-server/oauth/mcp` | Cloudflare Pages `fc-landing`, RFC 8414 discovery |
| `https://firstcrackiscoming.com/oauth/mcp/{authorize,token,revoke}` | Same landing; fixed-backend proxy, no cookies/native bearer forwarded |
| `https://firstcrackiscoming.com/oauth/consent` | Existing SSR login and explicit roastery selection |
| `https://firstcrackiscoming.com/account/connections` | Existing SSR identity, own grants and CSRF-protected revocation |
| `https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/firstcrack-oauth/*` | New Edge function, private issuer/token store operations |
| `https://api.firstcrackiscoming.com/mcp` | Public Streamable HTTP MCP endpoint and protected-resource discovery. The landing host forwards it to the existing `firstcrack-mcp` function. |

These are **proposed activation URLs**, not a claim that routes are deployed. The exact
host callback and client registration remain unconfirmed. No dynamic registration,
client secret, OAuth provider enablement, Auth token hook or PostgREST hook is needed.

1. A static enabled client must match issuer, resource and the exact HTTPS callback.
   Authorization Code + S256 PKCE and state are required; unknown/duplicate parameters
   and scope/resource expansion are rejected.
2. SSR verifies the existing Supabase login. The native bearer is sent only to the fixed
   internal issuer endpoint. That endpoint independently uses verified claims + live
   Auth identity and native RLS to list the user's current workspaces. No editable
   user metadata or submitted subject ID supplies identity.
3. A same-origin, CSRF-protected POST selects one of those workspaces. The store checks
   membership again and binds the grant to user, client, resource and workspace owner.
   Domain `user_id` can be the team owner, not the logged-in member.
4. Codes expire after 2 minutes (pending requests after 10); access tokens after at most
   5 minutes. Refresh rotates on every use, with an absolute 30-day grant lifetime.
   Code/refresh replay revokes the grant family in a committed transaction, including
   concurrent refresh. Refresh cannot select another user, workspace or scope.
5. Tokens contain 256 random bits. Only SHA-256 hashes are persisted; plaintext bearer
   values exist in HTTPS responses/client storage. No operational signing key is required.
6. Every MCP request and read rechecks the opaque token, active client/grant, issuer,
   resource, expiry and current membership. No cache delays revocation/membership removal.
   The user can revoke only their own grants, or revoke by possession of a client-bound
   token. A foreign grant ID gives no existence signal.

## Database authority

`supabase/migrations/20261026120000_firstcrack_mcp_read_issuer.sql` is the issuer
schema. `supabase/proposals/firstcrack-mcp-opaque-issuer.sql` only points at it and
raises if applied. Private tables store static clients, pending authorizations,
grants and token hashes; none are exposed through PostgREST or to native users.

- `firstcrack_mcp_store`: NOLOGIN private-table/function owner; no customer-table SELECT.
- `firstcrack_mcp_issuer`: NOLOGIN execution role for fixed issuer operations only.
- `firstcrack_mcp_gateway`: NOLOGIN execution role for access lookup and fixed read tools.
- `firstcrack_mcp_data`: NOLOGIN customer query-function owner, column SELECT only,
  not a customer-table owner and no BYPASSRLS. Restrictive policies enforce the bound
  owner alongside existing membership policies. Reads use a read-only transaction.

Two separate server-only LOGIN credentials must inherit only the matching issuer or
gateway execution role. Runtime startup rejects superuser/BYPASSRLS, store/data-owner,
service-role, native-authenticated and opposite-runtime membership. The gateway cannot
submit a trusted subject: SQL derives identity from the stored token hash. Both current JSON claims and legacy subject/role GUCs are overwritten from the derived
grant on every membership/read check, so inherited session context cannot select a user.
No client
gets a DB credential or JWT usable by Auth/PostgREST/legacy write RPCs. There is no
service-role Supabase client in this flow. Server credentials still require normal
secret protection; the issuer credential is the authority to issue grants.

The inherited `firstcrack-reader.sql` and `firstcrack-oauth-token-hook.sql` proposals
are **superseded experimental material. Do not activate them**. Restrictive database
roles/scopes on native tokens do not isolate managed Auth account mutation APIs.
`_shared/auth.ts` continues to reject integration JWTs on existing privileged handlers;
its verified subject must match the live native Auth identity.

## Read tools and limits

| Tool | Returned data |
| --- | --- |
| `get_my_profile` | Caller's own name, business and country; no billing/email identifiers |
| `list_my_workspaces` | Connected roastery only |
| `list_green_stock` | Green bean on-hand grams, excluding `expected_inbound` |
| `list_roasted_stock` | Bulk roasted on-hand grams |
| `list_product_stock` | Finished-goods on-hand units |
| `list_orders` | Platform, channel order id, shipment status, fulfillment time, line quantities. No buyer, amount, raw payload, or tracking number |

Pages default to 50, maximum 100; offsets maximum 10000. Nested order lines and plan
batches are capped at 1000 per parent. Workspace choices and recent connection lists
are capped at 100. Reads return on-hand stock and order shipment status. Roast curves,
buyer details, amounts, tracking numbers, equipment and live sensor data are not included.
No stock adjustment or `compute_inventory_alerts` call exists. A workspace owner whose
plan is not `pro`, `pro_plus`, `enterprise`, `team` or `tester` gets `insufficient_plan`.
Login/read failures never
fall back to sample data. Sample simulation remains a separate plugin skill/flow.

## Local verification

Apply both repository patches before the integration run. From `firstcrack`:

```sh
# Default sibling checkout is ../fc-landing; override with an absolute path if needed.
MCP_TEST_LANDING_ROOT=/path/to/fc-landing bash supabase/tests/test-mcp-opaque.sh
# Optional MCP_TEST_DOCKER_HOST selects a local test Docker daemon.
pnpm --config.verify-deps-before-run=false exec vitest run supabase/functions
pnpm --config.verify-deps-before-run=false dlx deno@2.9.6 check --no-lock --node-modules-dir=none supabase/functions/*/index.ts supabase/tests/mcp-opaque.integration.ts
pnpm --config.verify-deps-before-run=false typecheck
```

The runner creates and destroys only its own loopback PostgreSQL 17 container, matching
the hosted project's reported major version. It uses the issuer migration SQL/RLS/functions,
separate fixture DB credentials, the actual landing consent/proxy controllers, actual
Supabase SDK native identity verification and the official MCP SDK 1.32.2 over local HTTP.
HTTPS logical fixture origins are mapped to loopback; real credentials/remote requests
are refused. Native Auth/JWKS are fixture implementations, not hosted Auth verification.
It verifies login return, invalid/expired/non-native proofs, exact callback/resource,
PKCE, code expiry/replay, user/roastery isolation, access/refresh/grant expiry, SDK automatic
refresh, rotation/concurrent replay, user/token revocation and membership removal.

The issuer SQL is `supabase/migrations/20261026120000_firstcrack_mcp_read_issuer.sql`.
Fixture coverage cannot prove the entire migration chain, real gateway behavior,
deployed RLS interactions or hosted browser/desktop coexistence.
The Cloudflare build uses only fixture public config and reports existing adapter warnings.

Final local results: **297 Edge Vitest tests**, **119 integration assertions**, **16
landing tests**, all **19 Edge entrypoints** plus integration-script Deno checks, all
three desktop TypeScript configurations, and the three landing controller TypeScript
checks passed. The landing production build passed (existing adapter warnings). Actual
local Astro HTTP requests returned consent/connections → existing login 303, login HTML
200 and cross-origin grant revocation 403. Runtime-only billing/service bindings for
that HTTP check were explicit unused fixture placeholders, not operational credentials.

## Operational approval package — none executed

| Target | Exact proposed action / stored material | Effect |
| --- | --- | --- |
| Local test environment | Permit required Supabase image pulls; run `supabase start` + `supabase db reset --local` against an isolated project | Must precede turning SQL into a migration; no hosted reset |
| Supabase `vjdgdolfxvnxushxrmff` | Review latest policies/helpers; apply opaque-issuer tables, functions, SELECT columns and role-specific policies via the normal migration path | Persistent delegated read access to the stock and order DTOs; no change to native Auth scopes/hooks or existing user write rights |
| Same project | Provision two limited LOGIN DB credentials; store DSNs only as Edge server secrets `FIRSTCRACK_OAUTH_DATABASE_URL` and `FIRSTCRACK_MCP_DATABASE_URL` | Secret values must never enter repository, browser, plugin or logs. No signing key/client secret required |
| Same project | Add a disabled static `private.mcp_clients` record, then enable only after approved host client ID/exact callback verification | Public PKCE client; no new native Supabase OAuth grant/provider setup |
| Same project | Deploy `firstcrack-oauth` and `firstcrack-mcp` with function-specific `verify_jwt=false`; configure `FIRSTCRACK_MCP_ISSUER_URL`, `FIRSTCRACK_MCP_RESOURCE_URL`, `FIRSTCRACK_MCP_CLIENT_IDS`, optional `FIRSTCRACK_MCP_ALLOWED_ORIGINS`, `FIRSTCRACK_OAUTH_CONSENT_URL`; finally enable `FIRSTCRACK_OAUTH_ENABLED`/`FIRSTCRACK_MCP_ENABLED` | Public discovery/OAuth routes; all identity/read paths authenticate internally. Source `config.toml` records the required gate settings but they have not been applied |
| Cloudflare Pages `fc-landing` | Deploy landing source; set server-only `MCP_OAUTH_ISSUER_URL`, `MCP_OAUTH_RESOURCE_URL`, `MCP_OAUTH_CLIENT_IDS`, `MCP_OAUTH_REDIRECT_URIS`; finally enable `MCP_OAUTH_ENABLED` and `MCP_OAUTH_READONLY_READY` | Reuses existing password/Google SSR login. No desktop callback/session changes. External app never receives native cookies/tokens |
| Existing USER/PRIVATE plugin `plugins_6adabf9c7ed48191b394c7d62778dccd` | After hosted checks, add tested streamable-http endpoint/auth through its existing update path | Obtain exact callback/client ID from host management, never invent them. Re-read current release and use expected-release conflict protection. Preserve both manifests, images, ID/audience and sample default prompt; sample commands remain explicit |

Sequence: complete isolated replay and permission audit → approve specific hosted changes
→ provision disabled store/client/secrets → deploy with flags off → verify discovery and
failure behavior → enable for one consenting test user → exercise real login, multi-roastery
consent, expiry/refresh/replay/revocation and unchanged desktop login → update the existing
private plugin → expand only within approved scope. A real host/client registration is
still required; localhost SDK evidence is not a finished plugin login.

Rollback: disable issuer/MCP/landing flags first; disable the static client and revoke its
grants; return the plugin to sample-only configuration; roll back Edge/landing releases.
Remove/rotate the dedicated LOGIN credentials and grants after requests are stopped.
Keep native-token refusal and customer RLS intact. No native token hook is installed by
this design and none should be enabled as a shortcut. Expired private records need a
separately reviewed retention/cleanup policy; no operational scheduler was installed.

References: [Supabase OAuth constraints](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows),
[OpenAI plugin auth](https://developers.openai.com/plugins/build/auth),
[RFC 9700](https://www.rfc-editor.org/rfc/rfc9700), [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707).
Supabase documentation was read through its documentation connector. This environment
blocked the direct OpenAI auth-page fetch; current host-specific redirect/registration
requirements remain to be checked in the host management interface before activation.
