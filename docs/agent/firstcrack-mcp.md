# Firstcrack authenticated read-only MCP — implementation and activation boundary

Status: local source implementation, disabled by default. No hosted settings, database,
OAuth clients/grants, deployment, plugin release or sharing have been changed.

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
   approved OAuth `client_id`, `firstcrack:read` scope, dedicated `firstcrack_reader` role,
   non-anonymous identity and signed `firstcrack_workspace_owner_id` UUID.
4. Every tool rechecks `has_workspace_access` using the caller's JWT. It never uses service role.
5. Workspace data uses the connection's owner ID, which can differ from the member's user ID.
   A tool argument cannot switch to another owner, even another roastery the user belongs to.
   The personal profile is always filtered by the verified subject.

The selected workspace must be validated server-side during consent/token issuance and bound to
that grant. Client-supplied IDs and editable `user_metadata` must never populate authorization claims.
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

## OAuth and login still require integration

The desktop repository contains Supabase login/deep-link handling, but no landing SSR login,
`next`/callback/consent implementation and no existing MCP server. No landing source was attached
to this workspace; its cookie and redirect behavior cannot yet be verified or reused here.

The supported candidate is Supabase OAuth 2.1 Authorization Code with S256 PKCE, using the existing
user base and an explicit consent page. The host's exact redirect URI must come from its management
screen. Do not invent it, auto-register a client, enable dynamic registration or reuse native desktop
access/refresh tokens in the plugin. Keep the desktop session and each integration grant separate.

Important unresolved issuer capability: Supabase's documented standard OAuth scopes (`openid`,
`email`, `profile`, `phone`) control OIDC information, **not** database permissions. Support for issuing
the custom `firstcrack:read` scope and binding a workspace-specific grant has not been verified.
Default `aud: authenticated`, `role: authenticated` tokens are deliberately refused by this server.
An approved issuer integration must issue the dedicated role, resource audience and signed workspace
scope, and must preserve those restrictions on refresh. Compatibility of that audience/role with
Auth `getUser`, PostgREST and the currently hosted JWT settings still needs an end-to-end check.
Do not enable the feature simply by adding a scope label or a `readOnlyHint` annotation.

## Reviewable activation steps — none executed

1. Supply/inspect the existing landing source and verified HTTPS resource URL; implement its login,
   exact-return callback, consent, workspace selection, denial and revocation using the supported
   issuer APIs. Verify custom scope issuance, resource binding, S256 PKCE, refresh and expiry.
2. Convert the DB proposal into a CLI-generated migration only after reviewing existing hosted
   grants, RLS, PUBLIC functions and PostgREST configuration. Replay the full local Supabase chain,
   test actual PostgREST requests and all alternate write paths, then obtain approval to apply it.
3. Review the gateway setting needed for unauthenticated metadata/401 discovery. `supabase/config.toml`
   remains unchanged; this new function still inherits `verify_jwt = true`. A future approved
   function-specific `verify_jwt = false` must rely on this handler's verified authentication.
4. Deploy through the existing Edge Function workflow only when authorized. Keep disabled until
   OAuth and DB boundaries pass. Configure these server-side names without committing their values:
   `FIRSTCRACK_MCP_ENABLED`, `FIRSTCRACK_MCP_RESOURCE_URL`, `FIRSTCRACK_MCP_CLIENT_IDS`,
   `FIRSTCRACK_MCP_ALLOWED_ORIGINS`. `SUPABASE_URL`/`SUPABASE_ANON_KEY` are the existing platform bindings.
5. Check hosted protected-resource and authorization-server metadata, PKCE, missing/invalid/expired
   tokens, client/audience/scope mismatch, read-only enforcement, workspace isolation and revocation.
6. Only then update the existing standalone plugin via `update_plugin` with conflict protection:
   backend ID `plugins_6adabf9c7ed48191b394c7d62778dccd`, expected release
   `pluginrel_6adadf34170c8191addd45e9f73e1432` (recheck before publishing).
   Preserve USER/PRIVATE audience, both manifests, images, ID and existing default prompt. Add the
   verified Streamable HTTP endpoint without creating a new plugin or hosting project. Keep the
   explicit sample demo available separately; live authentication failures must remain errors.

## Local validation

```sh
pnpm --config.verify-deps-before-run=false test supabase/functions/firstcrack-mcp supabase/functions/_shared/auth.test.ts supabase/functions/handlers.test.ts
pnpm --config.verify-deps-before-run=false exec biome check supabase/functions/firstcrack-mcp supabase/functions/_shared/auth.ts supabase/functions/_shared/auth.test.ts
pnpm --config.verify-deps-before-run=false dlx deno@2.9.6 check --no-lock --node-modules-dir=none supabase/functions/firstcrack-mcp/index.ts
```

Cryptographic tests use ephemeral local ES256 keys with the real installed Supabase SDK and a stubbed
Auth/JWKS transport. They are not a live account or host OAuth test. The scratch SQL check runs only
against a disposable PostgreSQL 15 container with no host port published.

Verified locally on 2026-10-25: all 285 Edge Function Vitest tests passed; all 18 Edge Function
entrypoints passed Deno checking; the changed TypeScript files passed Biome; the isolated SQL
boundary fixture passed; frontend/test/e2e typechecking passed. The initial typecheck failure
was a missing declared `@tauri-apps/plugin-global-shortcut@2.4.1` dependency in the preinstalled
environment. It was installed into a temporary pnpm project and linked into ignored `node_modules`
for validation, without changing this repository's dependency manifests or lockfile.

## References

- [Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server)
- [MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [Token security and RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Verified claims](https://supabase.com/docs/reference/javascript/auth-getclaims)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)

Supabase docs were read through the connected documentation tool. Direct fetches of the Supabase
changelog and OpenAI auth page were denied by the environment's HTTP policy (403); that page's
current host-specific requirements are not claimed as verified. No proxy bypass was attempted.
