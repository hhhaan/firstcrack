# Firstcrack authenticated read-only MCP — implementation and activation boundary

Status: local source implementation, disabled by default. No hosted settings, database,
OAuth clients/grants, deployment, plugin release or sharing have been changed.

**Activation is blocked by an authentication design issue, not just deployment approval.**
Reviewed upstream Supabase Auth routes (`internal/api/api.go`, `auth.go`, `user.go`) authenticate
user tokens for account mutation independently of PostgREST RLS and do not show a reader-role
check on `UserUpdate`. Hosted behavior was not probed with a real write. Native Supabase OAuth
JWTs must not be exported to the plugin as an isolated read-only credential. The landing adapter
now refuses native approval server-side regardless of feature flags; its approve button is disabled.
The native token-hook SQL is an experimental proposal, **not a safe activation plan**.

The safe alternative requiring a design decision is an independent MCP issuer/token boundary
on existing hosting: existing Supabase login verifies identity, while the plugin receives only
MCP credentials that Supabase Auth cannot accept. Any upstream credentials stay server-side;
data queries use a least-privileged reader role with RLS and verified identity/workspace context.
Its signing key, persistent grant storage and credentials have not been created or configured.
Building a separate issuer before selecting that architecture would exceed this work unit.

## Implemented source

`supabase/functions/firstcrack-mcp/` implements stateless Streamable HTTP JSON responses:
`initialize`, `ping`, `tools/list`, `tools/call`, notifications and an explicit protected-resource
metadata URL advertised by the `WWW-Authenticate` challenge. GET/SSE sessions are not offered.
The server negotiates MCP 2025-06-18 or 2025-03-26 and rejects unsupported transport headers.

The seven read tools cover the caller's profile, the connected roastery, green bean definitions,
products, orders with quantities, stored day plans and saved roast sessions. Only allowlisted
columns are returned; each page is capped at 100 items. Order raw payloads, buyer details,
billing identifiers, credentials and roast file paths are excluded.

Limits: this is not an inventory balance tool. Bean definitions do not report stock balances.
Stored day plans do not expand virtual recurring occurrences. There are no production writes,
stock adjustments, equipment controls, live sensor feeds or sample fallback on login/read failure.

## Identity and authorization

1. Supabase `auth.getClaims(token)` verifies the JWT signature and expiry.
2. `auth.getUser(token)` checks the Auth identity and must match the verified `sub`.
3. Server policy verifies the configured issuer, resource audience, expiry, not-before,
   approved OAuth `client_id`, standard `openid` scope, signed `firstcrack_access: read`, dedicated `firstcrack_reader` role,
   non-anonymous identity and signed `firstcrack_workspace_owner_id` UUID.
4. Every tool rechecks `has_workspace_access` using the caller's JWT. It never uses service role.
5. Workspace data uses the connection's owner ID, which can differ from the member's user ID.
   A tool argument cannot switch to another owner, even another roastery the user belongs to.
   The personal profile is always filtered by the verified subject.

The initial token-hook proposal binds the workspace to the verified subject's own workspace.
It does not issue team-workspace grants. Client-supplied IDs and editable `user_metadata` never populate authorization claims.
Current membership is checked again for each read, so removing membership blocks an existing token.

`_shared/auth.ts#getAuthenticatedUser` now accepts verified first-party `authenticated` sessions
without an OAuth `client_id` only. This prevents integration tokens from invoking existing service-role
Edge Function writes. This intentionally rejects all third-party Supabase OAuth client tokens on
those existing handlers; ordinary Google/password desktop sessions are preserved. Channel OAuth
credentials stored by the existing sales-channel adapters are a separate flow.

## Database proposal — not activated

`supabase/proposals/firstcrack-reader.sql` is a review proposal, **not a migration**. It describes:

- A non-login, non-inheriting, non-bypass reader role with column-level SELECT grants only.
- Restrictive RLS bound to the selected workspace, alongside existing owner/member policies.
- A connection-scope restriction on `has_workspace_access` for the reader role only, retaining
  native session membership behavior even when the member belongs to several roasteries.
- A PostgREST pre-request guard that rejects writes and non-allowlisted RPCs, checks membership
  and scope, and enables a read-only transaction. PUBLIC SECURITY DEFINER RPCs can otherwise
  bypass table grants, so granting SELECT alone is insufficient.
- An approval-required PostgREST hook configuration step, left commented out. Any hosted
  pre-existing hook must be inspected and composed rather than replaced.

`supabase/tests/firstcrack-reader-boundary.sql` creates an isolated scratch fixture and exercises
the proposal, including another membership outside the selected workspace, protected columns,
table writes, a legacy PUBLIC SECURITY DEFINER write RPC, the permitted membership RPC and
membership removal. It does **not** replay all production migrations or prove hosted configuration.
Do not run this fixture on a real or linked database.

## OAuth provider constraint and credential prototype

The official [OAuth flow guide](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
explicitly says: **"Custom scopes are not currently supported."** Standard OIDC scopes do not
restrict database permissions. The earlier `firstcrack:read` scope was therefore replaced by
standard `openid` plus an independently verified application permission and reader DB role.

`supabase/proposals/firstcrack-oauth-token-hook.sql` proposes an Auth token hook with a private,
disabled-by-default client allowlist. Approved OAuth tokens receive the reader role, resource
audience, `firstcrack_access: read`, and workspace owner derived from the verified subject. Native
password/social-provider sessions remain unchanged. Refresh is subject to the same transformation.
The hook does not trust user-editable metadata and is not callable by the reader role. It has not
been configured in hosted Auth. Its audience array retains `authenticated` for Auth/PostgREST
compatibility and adds the exact resource audience; hosted compatibility still requires testing.

The existing landing source was located in **`hhhaan/fc-landing`** and checked out separately.
Its new `apps/landing/src/pages/oauth/consent.astro` reuses existing SSR login cookies and the
`/login?next=...` → `/auth/callback` return path. It shows the verified client, own-workspace read
scope and deny controls, with Origin/CSRF checks and exact callback allowlisting. Native approval is disabled and refused server-side.
It is disabled unless both `MCP_OAUTH_ENABLED` and `MCP_OAUTH_READONLY_READY` are explicitly true
and verified client/callback allowlists are configured. No persistent setting has been changed.
Already auto-approved provider responses fail closed with 409 because they omit review details;
reconnecting such a grant currently requires revocation and a new consent flow.

The host's exact redirect URI must come from its management screen. Do not invent it, enable
dynamic registration or pass native desktop access/refresh tokens to the plugin. Ordinary native
sessions remain separate. This first flow supports personal workspaces only; a team-workspace
picker requires a separately designed server-side grant binding before it can be offered.

## Conditions before any activation

1. Select and approve an isolated MCP issuer/credential design. Do not activate the native
   token-hook prototype as an external credential boundary. Reuse the current login/consent
   controller and MCP tool interfaces, replacing their issuer-specific adapters.
2. Complete full local Supabase replay and all alternate-path tests, including Auth account
   updates and grant administration, before provisioning hosted credentials or grants.
3. Obtain the host's exact callback URI and verify its metadata, PKCE, resource binding,
   token refresh, expiry, revocation and native session coexistence with a test account.
4. Only after these pass, approve the existing deployment/configuration paths and update the
   existing USER/PRIVATE plugin with backend ID `plugins_6adabf9c7ed48191b394c7d62778dccd`, checking
   current release against `pluginrel_6adadf34170c8191addd45e9f73e1432` again before publication.
   Preserve both manifests, images, plugin identity/audience and sample default prompt.

Current disabled runtime names: `FIRSTCRACK_MCP_ENABLED`, `FIRSTCRACK_MCP_RESOURCE_URL`,
`FIRSTCRACK_MCP_CLIENT_IDS`, `FIRSTCRACK_MCP_ALLOWED_ORIGINS`; landing names:
`MCP_OAUTH_ENABLED`, `MCP_OAUTH_READONLY_READY`, `MCP_OAUTH_CLIENT_IDS`, `MCP_OAUTH_REDIRECT_URIS`.
No values were set in hosted systems. `supabase/config.toml` remains unchanged; the new function
still inherits the gateway's JWT requirement. Future public discovery must be reviewed separately.

## Local validation

```sh
pnpm --config.verify-deps-before-run=false test supabase/functions/firstcrack-mcp supabase/functions/_shared/auth.test.ts supabase/functions/handlers.test.ts
pnpm --config.verify-deps-before-run=false exec biome check supabase/functions/firstcrack-mcp supabase/functions/_shared/auth.ts supabase/functions/_shared/auth.test.ts
pnpm --config.verify-deps-before-run=false dlx deno@2.9.6 check --no-lock --node-modules-dir=none supabase/functions/firstcrack-mcp/index.ts
```

Cryptographic tests use ephemeral local ES256 keys with the real installed Supabase SDK and a stubbed
Auth/JWKS transport. They are not a live account or host OAuth test. The scratch SQL check runs only
against a disposable PostgreSQL 15 container with no host port published.

Verified locally on 2026-10-25: all 287 Edge Function Vitest tests passed; all 18 Edge Function
entrypoints passed Deno checking; the changed TypeScript files passed Biome; the isolated SQL
boundary fixture passed; frontend/test/e2e typechecking passed. The initial typecheck failure
was a missing declared `@tauri-apps/plugin-global-shortcut@2.4.1` dependency in the preinstalled
environment. It was installed into a temporary pnpm project and linked into ignored `node_modules`
for validation, without changing this repository's dependency manifests or lockfile.

Landing consent tests pass (11 cases) and `pnpm build:landing` passes. Actual local Astro HTTP requests verified
303 → existing login, login HTML 200, and cross-origin approval 403, using fixture configuration
with no real account. SQL scratch checks verify the token hook, refresh scope, native sessions
and denied reader access to the hook/configuration. The official MCP SDK 1.32.2 passed a local HTTP
fixture through protected-resource/issuer discovery, S256 PKCE (wrong verifier denied), code exchange,
initialization, seven tools, a signed authenticated read and foreign-workspace denial:

```sh
pnpm --config.verify-deps-before-run=false dlx deno@2.9.6 run --no-lock --node-modules-dir=none --allow-net=127.0.0.1 --allow-env supabase/tests/firstcrack-mcp-protocol.ts
```

This OAuth fixture is not the hosted Supabase issuer, and the Auth/JWKS identity in that fixture
is simulated. No real account login, OAuth client or hosted grant was created.

Full local Supabase verification is blocked: CLI 2.121.0 `supabase start` in an isolated temporary
project failed to pull from `https://public.ecr.aws/v2/` (Forbidden). The attempt was stopped; no
mirror/proxy bypass or retry was used and `supabase db reset --local` was **not executed**. No
local containers remain from that attempt. The hosted project's metadata reports PostgreSQL 17;
the repository local config and scratch tests use PostgreSQL 15, another item for compatibility review.

## Targets and approval scope after the issuer design decision

No actions in this table have been executed. This is not permission to activate the native-token prototype.

| Target | Proposed change and access | Impact and prerequisites |
| --- | --- | --- |
| Execution environment only | Allow image pulls from `public.ecr.aws` to complete isolated local Supabase replay/testing | No production access; currently blocked by network policy. Do this before DB activation approval. |
| Supabase **first crack**, project `vjdgdolfxvnxushxrmff` | Review/apply reader role, column grants, selected-workspace RLS, membership guard, appropriate internal reader boundary after issuer design review; native token hook stays unapproved | Read-only access to the seven DTOs above, own workspace only. No service-role client, production writes or equipment control. Full local replay and existing hook/policy audit must pass first. |
| Existing Auth/login plus an isolated MCP issuer on existing hosting | First approve the issuer boundary, signing-key/grant-store provisioning and exact host callback. Do not enable the native-token hook for external access. | This introduces persistent delegated read access; the plugin credential must be rejected by Supabase Auth mutation APIs. Native browser/desktop sessions must remain separate. |
| Same Supabase project's `firstcrack-mcp` function | Approve function-specific gateway discovery configuration, existing deployment and disabled-by-default runtime bindings | Public metadata/401 discovery only; every data method remains authenticated. Other functions' gateway settings are unchanged. |
| Cloudflare Pages **fc-landing**, `firstcrackiscoming.com` | Deploy the existing landing repository's consent route and configure exact client/callback allowlists; enable only after issuer/DB checks | Reuses browser session cookies, does not share them with the plugin and does not replace desktop login. Callback value is still unverified and must be obtained from the host. |
| Existing USER/PRIVATE `firstcrack-test` plugin | Update its existing manifests/MCP connection with expected-release conflict protection after hosted smoke tests | Preserve plugin identity, images, scope/audience and demo prompt. No new plugin, hosting project, sharing or public release. |

Rollback must start by disabling the MCP/consent feature flags, disabling the approved OAuth client
and revoking its refresh grants/sessions. Retain the DB reader restrictions and privileged-EF guard
until outstanding tokens are expired/revoked. Only then restore previous Auth/PostgREST hooks and
remove the new grants/role. **Removing the token hook while OAuth refresh remains enabled could
mint unrestricted native-role tokens**, so it is not a safe standalone rollback. The plugin can
be returned to its previous sample-only release without changing its identity or audience.

## References

- [Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server)
- [MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [Token security and RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Verified claims](https://supabase.com/docs/reference/javascript/auth-getclaims)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)

Supabase docs were read through the connected documentation tool. Direct fetches of the Supabase
changelog and OpenAI auth page were denied by the environment's HTTP policy (403); that page's
current host-specific requirements are not claimed as verified. No proxy bypass was attempted.

Upstream evidence: https://github.com/supabase/auth/blob/master/internal/api/user.go and https://github.com/supabase/auth/blob/master/internal/api/auth.go . These reads do not establish the hosted version or prove managed Auth isolation.
