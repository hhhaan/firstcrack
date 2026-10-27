/** Disposable PostgreSQL/native-login fixtures only. Never connects to a hosted account. */

import type { OAuthClientProvider } from 'npm:@modelcontextprotocol/sdk@1.32.2/client/auth.js';
import { Client } from 'npm:@modelcontextprotocol/sdk@1.32.2/client/index.js';
import { StreamableHTTPClientTransport } from 'npm:@modelcontextprotocol/sdk@1.32.2/client/streamableHttp.js';
import type { OAuthTokens } from 'npm:@modelcontextprotocol/sdk@1.32.2/shared/auth.js';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import postgres from 'npm:postgres@3.4.9';
import { opaqueDependencies } from '../functions/_shared/mcp-oauth/access.ts';
import { digest, pkce } from '../functions/_shared/mcp-oauth/crypto.ts';
import { createIssuerHandler } from '../functions/_shared/mcp-oauth/http.ts';
import { resolveNativeIdentity } from '../functions/_shared/mcp-oauth/identity.ts';
import { issuerStore, readGateway } from '../functions/_shared/mcp-oauth/postgres.ts';
import { IssuerService } from '../functions/_shared/mcp-oauth/service.ts';
import { createMcpHandler } from '../functions/firstcrack-mcp/server.ts';

const port = Deno.args[0] ?? '55432';
if (!/^\d{4,5}$/.test(port)) throw new Error('Expected a local fixture port');
const admin = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 4, onnotice: () => {} });
const store = issuerStore(`postgres://mcp_issuer_test@127.0.0.1:${port}/postgres`);
const gateway = readGateway(`postgres://mcp_gateway_test@127.0.0.1:${port}/postgres`);
const issuer = 'https://identity.example/oauth/mcp';
const resource = 'https://resource.example/mcp';
const project = 'https://native.example';
const callback = 'https://host.example/callback';
const a = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const b = '33333333-3333-4333-8333-333333333333';
const outsider = '44444444-4444-4444-8444-444444444444';
let checks = 0;
function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
    checks++;
}
const landingRoot = new URL(
    Deno.args[1] ? `${Deno.args[1].replace(/\/$/, '')}/` : '../../../fc-landing/',
    import.meta.url,
);
const { handleMcpConsent } = await import(new URL('apps/landing/src/lib/mcpConsent.ts', landingRoot).href);
const { issuerConsentClient, proxyIssuerRequest } = await import(
    new URL('apps/landing/src/lib/mcpIssuer.ts', landingRoot).href
);
const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = await crypto.subtle.exportKey('jwk', key.publicKey);
const encode = (input: Uint8Array | string) =>
    btoa(typeof input === 'string' ? input : String.fromCharCode(...input))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
const decode = (input: string) =>
    Uint8Array.from(atob(input.replace(/-/g, '+').replace(/_/g, '/')), (s) => s.charCodeAt(0));
async function nativeToken(id: string, extra: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    const raw = `${encode(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'native-fixture' }))}.${encode(JSON.stringify({ sub: id, aud: 'authenticated', iss: `${project}/auth/v1`, role: 'authenticated', iat: now, exp: now + 3600, ...extra }))}`;
    return `${raw}.${encode(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, new TextEncoder().encode(raw))))}`;
}
async function nativeClaims(req: Request) {
    try {
        const token = req.headers.get('Authorization')?.replace(/^Bearer /i, '') ?? '';
        const [header, body, signature] = token.split('.');
        if (
            !header ||
            !body ||
            !signature ||
            !(await crypto.subtle.verify(
                { name: 'ECDSA', hash: 'SHA-256' },
                key.publicKey,
                decode(signature),
                new TextEncoder().encode(`${header}.${body}`),
            ))
        )
            return null;
        const claims = JSON.parse(new TextDecoder().decode(decode(body)));
        return claims.exp > Date.now() / 1000 && [a, owner, b, outsider].includes(claims.sub) ? claims : null;
    } catch {
        return null;
    }
}
const oldEnv = new Map(['SUPABASE_URL', 'SUPABASE_ANON_KEY'].map((name) => [name, Deno.env.get(name)]));
Deno.env.set('SUPABASE_URL', project);
Deno.env.set('SUPABASE_ANON_KEY', 'fixture-public-key');
const service = new IssuerService(
    { issuer, resource, consentUrl: 'https://identity.example/oauth/consent', allowedOrigins: [] },
    store,
);
const oauth = createIssuerHandler({ service, identity: resolveNativeIdentity });
const mcpConfig = { issuer, resource, clientIds: ['fixture-client'], allowedOrigins: [] };
const mcp = createMcpHandler({
    config: mcpConfig,
    ...opaqueDependencies(mcpConfig, gateway),
    reportError: async () => {
        throw new Error('Unexpected read failure');
    },
});
const originalFetch = globalThis.fetch;
let accountWrites = 0;
const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async (incoming) => {
    const logical = incoming.headers.get('X-Fixture-URL');
    if (!logical) return new Response('Fixture header required', { status: 400 });
    const req = new Request(logical, incoming);
    const url = new URL(logical);
    if (url.origin === project && url.pathname.startsWith('/functions/v1/firstcrack-oauth/')) return oauth(req);
    if (url.origin === 'https://identity.example') {
        const action = url.pathname.startsWith('/.well-known/') ? 'metadata' : (url.pathname.split('/').at(-1) ?? '');
        return proxyIssuerRequest(req, action, { enabled: true, issuer, project }, fixtureFetch);
    }
    if (url.origin === 'https://resource.example') return mcp(req);
    if (url.origin !== project) return new Response('Unknown fixture', { status: 404 });
    if (url.pathname.endsWith('/.well-known/jwks.json'))
        return Response.json({ keys: [{ ...publicKey, kid: 'native-fixture', alg: 'ES256', use: 'sig' }] });
    const claims = await nativeClaims(req);
    if (!claims) return Response.json({ message: 'Invalid JWT', error_code: 'bad_jwt' }, { status: 401 });
    if (url.pathname === '/auth/v1/user') {
        if (req.method !== 'GET') {
            accountWrites++;
            return Response.json({});
        }
        return Response.json({
            id: claims.sub,
            email: `${claims.sub.slice(0, 8)}@fixture.invalid`,
            is_anonymous: false,
            role: 'authenticated',
        });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
        const data = await admin.begin(async (tx) => {
            await tx`set local role authenticated`;
            await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
            if (url.pathname.endsWith('/organizations'))
                return tx`select owner_id,name from public.organizations order by id limit 100`;
            if (url.pathname.endsWith('/profiles'))
                return tx`select business_name,display_name from public.profiles where id=${claims.sub}::uuid`;
            return [];
        });
        return Response.json(data);
    }
    return new Response('Not found', { status: 404 });
});
const local = `http://127.0.0.1:${server.addr.port}`;
function fixtureFetch(input: string | URL | Request, init?: RequestInit) {
    const request = new Request(input, init);
    const target = new URL(request.url);
    if (!['identity.example', 'resource.example', 'native.example'].includes(target.hostname))
        throw new Error('Non-fixture destination refused');
    const rewritten = new URL(`${target.pathname}${target.search}`, local);
    const forwarded = new Request(rewritten, request);
    forwarded.headers.set('X-Fixture-URL', request.url);
    return originalFetch(forwarded);
}
globalThis.fetch = fixtureFetch;
const clients: Client[] = [];
async function session(id?: string) {
    const client = createClient(project, 'fixture-public-key', {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: crypto.randomUUID(),
        },
        global: { fetch: fixtureFetch },
    });
    if (id)
        await client.auth.setSession({
            access_token: await nativeToken(id),
            refresh_token: 'native-fixture-refresh-not-exported',
        });
    return issuerConsentClient(client, project, fixtureFetch);
}
const policy = {
    enabled: true,
    readOnlyReady: true,
    issuer,
    resource,
    clientIds: ['fixture-client'],
    redirectUris: [callback],
};
const authA = await session(a);
const authB = await session(b);
const authOutsider = await session(outsider);
async function start() {
    const verifier = encode(crypto.getRandomValues(new Uint8Array(48)));
    const params = new URLSearchParams({
        client_id: 'fixture-client',
        redirect_uri: callback,
        response_type: 'code',
        scope: 'firstcrack:read',
        state: crypto.randomUUID(),
        code_challenge_method: 'S256',
        code_challenge: await pkce(verifier),
        resource,
    });
    const response = await fixtureFetch(`${issuer}/authorize?${params}`, { redirect: 'manual' });
    check(response.status === 303, 'Authorization did not reach consent');
    const location = response.headers.get('Location') ?? '';
    const id = new URL(location).searchParams.get('authorization_id') ?? '';
    return { verifier, state: params.get('state'), location, id };
}
async function approve(request: Awaited<ReturnType<typeof start>>, auth = authA, selected = owner) {
    const review = await handleMcpConsent(new Request(request.location), auth, policy);
    check(review.kind === 'review', 'Verified user did not receive consent review');
    const csrf = `${request.id}.fixture-csrf`;
    const form = new FormData();
    form.set('decision', 'approve');
    form.set('csrf', csrf);
    form.set('workspace_owner_id', selected);
    const decision = await handleMcpConsent(
        new Request(request.location, { method: 'POST', headers: { Origin: 'https://identity.example' } }),
        auth,
        policy,
        csrf,
        form,
    );
    return decision;
}
async function exchange(request: Awaited<ReturnType<typeof start>>, auth = authA, selected = owner) {
    const decision = await approve(request, auth, selected);
    check(decision.kind === 'redirect', 'Consent approval failed');
    const redirect = new URL(decision.location);
    check(redirect.searchParams.get('state') === request.state, 'OAuth state changed');
    check(redirect.searchParams.get('iss') === issuer, 'Authorization response omitted iss');
    const code = redirect.searchParams.get('code') ?? '';
    const body = new URLSearchParams({
        client_id: 'fixture-client',
        grant_type: 'authorization_code',
        code,
        code_verifier: request.verifier,
        redirect_uri: callback,
        resource,
    });
    const response = await fixtureFetch(`${issuer}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    check(response.status === 200, 'Code exchange failed');
    return { tokens: await response.json(), body };
}
const lookup = async (token: string) => gateway.access(await digest(token), issuer, resource);
const rotate = (refresh: string, extra: Record<string, string> = {}) =>
    fixtureFetch(`${issuer}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: 'fixture-client',
            refresh_token: refresh,
            resource,
            ...extra,
        }),
    });
try {
    check(
        (await createIssuerHandler({ service: null, identity: async () => null })(new Request(`${issuer}/metadata`)))
            .status === 503,
        'Unconfigured issuer did not fail closed',
    );
    for (const proof of [
        'invalid.fixture.jwt',
        await nativeToken(a, { exp: 1 }),
        await nativeToken(a, { client_id: 'external-client' }),
        await nativeToken(a, { role: 'service_role' }),
    ]) {
        const denied = await fixtureFetch(`${project}/functions/v1/firstcrack-oauth/grants`, {
            headers: { Authorization: `Bearer ${proof}` },
        });
        check(denied.status === 401, 'Invalid, expired or non-native login proof accepted');
    }
    const tamper = await start();
    const authorizeParams = new URLSearchParams({
        client_id: 'fixture-client',
        redirect_uri: callback,
        response_type: 'code',
        scope: 'firstcrack:read',
        state: tamper.state ?? '',
        code_challenge_method: 'S256',
        code_challenge: await pkce(tamper.verifier),
        resource,
    });
    for (const [field, value] of [
        ['redirect_uri', 'https://attacker.example/callback'],
        ['scope', 'openid'],
        ['resource', 'https://other.example/mcp'],
        ['code_challenge_method', 'plain'],
        ['client_id', 'unknown'],
    ]) {
        const changed = new URLSearchParams(authorizeParams);
        changed.set(field, value);
        check(
            (await fixtureFetch(`${issuer}/authorize?${changed}`, { redirect: 'manual' })).status === 400,
            'Unregistered OAuth request accepted',
        );
    }
    const pkceDecision = await approve(tamper);
    check(pkceDecision.kind === 'redirect', 'PKCE fixture approval failed');
    const pkceCode = new URL(pkceDecision.location).searchParams.get('code') ?? '';
    const badExchange = new URLSearchParams({
        client_id: 'fixture-client',
        grant_type: 'authorization_code',
        code: pkceCode,
        code_verifier: 'x'.repeat(64),
        redirect_uri: callback,
        resource,
    });
    check(
        (
            await fixtureFetch(`${issuer}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: badExchange,
            })
        ).status === 400,
        'Wrong PKCE verifier exchanged',
    );
    badExchange.set('code_verifier', tamper.verifier);
    badExchange.set('redirect_uri', 'https://attacker.example/callback');
    check(
        (
            await fixtureFetch(`${issuer}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: badExchange,
            })
        ).status === 400,
        'Code exchanged for a different redirect',
    );
    await admin`update private.mcp_authorizations set code_expires_at=now()-interval '1 second' where id=${tamper.id}::uuid`;
    badExchange.set('redirect_uri', callback);
    check(
        (
            await fixtureFetch(`${issuer}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: badExchange,
            })
        ).status === 400,
        'Expired authorization code exchanged',
    );
    // The actual landing controller and native Supabase SDK prove login before consent.
    const initial = await start();
    const anonymous = await session();
    const login = await handleMcpConsent(new Request(initial.location), anonymous, policy);
    check(
        login.kind === 'login' && login.location.includes(encodeURIComponent(initial.id)),
        'Login return lost the authorization',
    );
    const blockedConsent = await approve(initial, authOutsider, owner);
    check(
        blockedConsent.kind === 'unavailable' && blockedConsent.status === 403,
        'Non-member obtained a workspace grant',
    );
    const { tokens } = await exchange(initial);
    check(/^fcmcp_at_/.test(tokens.access_token) && !tokens.access_token.includes('.'), 'Native JWT leaked to client');
    check((await lookup(tokens.access_token))?.sub === a, 'Token subject is not the verified user');
    const read = await gateway.read(await digest(tokens.access_token), issuer, resource, 'list_orders', {});
    check(
        Array.isArray(read.rows) && read.rows.length === 1 && read.rows[0].platform_order_id === 'A-1',
        'Owner-row isolation failed',
    );
    for (const tool of [
        'get_my_profile',
        'list_my_workspaces',
        'list_green_stock',
        'list_roasted_stock',
        'list_product_stock',
        'list_orders',
    ]) {
        const page = await gateway.read(await digest(tokens.access_token), issuer, resource, tool, {});
        check(Array.isArray(page.rows) && page.rows.length === 1, `Fixed read function failed for ${tool}`);
        check(
            !JSON.stringify(page.rows).includes('private-') &&
                !JSON.stringify(page.rows).includes('outside-connection'),
            'Protected data escaped the fixed projection',
        );
    }
    await admin`update public.profiles set plan='read_only' where id=${owner}::uuid`;
    const unpaid = await gateway.read(await digest(tokens.access_token), issuer, resource, 'list_orders', {});
    check(unpaid.error === 'insufficient_plan', 'A read-only plan read operational stock');
    await admin`update public.profiles set plan='pro' where id=${owner}::uuid`;
    const foreign = await gateway.read(await digest(tokens.access_token), issuer, resource, 'list_orders', {
        workspace_owner_id: b,
    });
    check(foreign.error === 'access_denied', 'A different member workspace escaped consent scope');
    check(
        (await gateway.access(await digest(tokens.access_token), issuer, 'https://other.example')) === null,
        'Resource binding missing',
    );
    const tokenB = (await exchange(await start(), authB, b)).tokens;
    const readB = await gateway.read(await digest(tokenB.access_token), issuer, resource, 'list_orders', {});
    check(
        Array.isArray(readB.rows) && readB.rows.length === 1 && readB.rows[0].platform_order_id === 'B-1',
        'Another user received first user rows',
    );
    const writes = await fixtureFetch(`${project}/auth/v1/user`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
        body: '{}',
    });
    check(writes.status === 401 && accountWrites === 0, 'MCP token authorized a native Auth mutation');
    const restWrite = await fixtureFetch(`${project}/rest/v1/beans`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
        body: '{}',
    });
    check(restWrite.status === 401, 'MCP bearer authorized an alternate native data path');
    const management = await fixtureFetch(`${project}/functions/v1/firstcrack-oauth/grants`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    check(management.status === 401, 'MCP token impersonated a native session');
    const nativeJwt = await nativeToken(a);
    check(
        (await opaqueDependencies(mcpConfig, gateway).verify(new Request(resource), nativeJwt)) === null,
        'Native JWT accepted by MCP',
    );
    const changed = await rotate(tokens.refresh_token, { workspace_owner_id: b });
    check(changed.status === 400, 'Refresh accepted an owner override');
    const refreshed = await rotate(tokens.refresh_token);
    check(refreshed.status === 200, 'Refresh failed');
    const next = await refreshed.json();
    check((await lookup(next.access_token))?.firstcrack_workspace_owner_id === owner, 'Refresh changed roastery');
    const replay = await rotate(tokens.refresh_token);
    check(replay.status === 400, 'Refresh token reused');
    check((await lookup(next.access_token)) === null, 'Refresh replay did not revoke the family');
    const expired = (await exchange(await start())).tokens;
    await admin`update private.mcp_tokens set expires_at=now()-interval '1 second',issued_at=now()-interval '1 hour' where hash=${await digest(expired.access_token)}`;
    check((await lookup(expired.access_token)) === null, 'Expired access token accepted');
    const renewed = await rotate(expired.refresh_token);
    check(renewed.status === 200, 'Valid refresh could not recover an expired access token');
    const renewedTokens = await renewed.json();
    const revoke = await fixtureFetch(`${issuer}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: 'fixture-client', token: renewedTokens.refresh_token }),
    });
    check(
        revoke.status === 200 && (await lookup(renewedTokens.access_token)) === null,
        'Revocation did not block access',
    );
    check((await rotate(renewedTokens.refresh_token)).status === 400, 'Revoked grant refreshed');
    const refreshExpired = (await exchange(await start())).tokens;
    await admin`update private.mcp_tokens set issued_at=now()-interval '2 days',expires_at=now()-interval '1 day' where hash=${await digest(refreshExpired.refresh_token)}`;
    check((await rotate(refreshExpired.refresh_token)).status === 400, 'Expired refresh token accepted');
    const grantExpired = (await exchange(await start())).tokens;
    await admin`update private.mcp_grants set created_at=now()-interval '31 days',expires_at=now()-interval '1 second' where id=(select grant_id from private.mcp_tokens where hash=${await digest(grantExpired.access_token)})`;
    check(
        (await lookup(grantExpired.access_token)) === null && (await rotate(grantExpired.refresh_token)).status === 400,
        'Expired grant accepted',
    );
    const live = (await exchange(await start())).tokens;
    const grants = await authA.getGrants();
    const ownGrants = grants.data.grants;
    const liveHash = await digest(live.access_token);
    const [{ grant_id: liveGrant }] = await admin`select grant_id from private.mcp_tokens where hash=${liveHash}`;
    check(
        ownGrants.some((grant: { id: string }) => grant.id === liveGrant),
        'Owner cannot manage their grant',
    );
    await authB.revokeGrant(liveGrant);
    check((await lookup(live.access_token)) !== null, 'Another user revoked the grant');
    await authA.revokeGrant(liveGrant);
    check((await lookup(live.access_token)) === null, 'Owner revocation failed');
    const oneTime = await exchange(await start());
    const reusedCode = await fixtureFetch(`${issuer}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: oneTime.body,
    });
    check(
        reusedCode.status === 400 && (await lookup(oneTime.tokens.access_token)) === null,
        'Authorization code replay not contained',
    );
    const concurrent = (await exchange(await start())).tokens;
    const pair = await Promise.all([rotate(concurrent.refresh_token), rotate(concurrent.refresh_token)]);
    check(
        pair.filter((response) => response.status === 200).length === 1 &&
            pair.filter((response) => response.status === 400).length === 1,
        'Concurrent refresh issued two families',
    );
    const winnerResponse = pair.find((response) => response.status === 200);
    check(winnerResponse, 'Concurrent refresh returned no success');
    const winner = await winnerResponse.json();
    check((await lookup(winner.access_token)) === null, 'Concurrent replay revocation rolled back');
    // Real MCP SDK discovers the independent issuer and completes a fresh S256 flow.
    let sdkTokens: OAuthTokens | undefined;
    let verifier = '';
    let authUrl: URL | undefined;
    const sdkState = crypto.randomUUID();
    const provider: OAuthClientProvider = {
        redirectUrl: callback,
        clientMetadata: {
            redirect_uris: [callback],
            client_name: 'Fixture client',
            scope: 'firstcrack:read',
            token_endpoint_auth_method: 'none',
        },
        clientInformation: () => ({ client_id: 'fixture-client' }),
        tokens: () => sdkTokens,
        saveTokens: (value: OAuthTokens) => {
            sdkTokens = value;
        },
        saveCodeVerifier: (value: string) => {
            verifier = value;
        },
        codeVerifier: () => verifier,
        state: () => sdkState,
        redirectToAuthorization: (value: URL) => {
            authUrl = value;
        },
    };
    const sdk = new Client({ name: 'opaque-integration', version: '1' });
    clients.push(sdk);
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
        authProvider: provider,
        fetch: fixtureFetch,
    });
    try {
        await sdk.connect(transport);
    } catch {
        /* Expected redirect. */
    }
    check(authUrl, 'SDK issuer discovery failed');
    const toConsent = await fixtureFetch(authUrl, { redirect: 'manual' });
    const consent = toConsent.headers.get('Location') ?? '';
    const sdkId = new URL(consent).searchParams.get('authorization_id') ?? '';
    const sdkDecision = await approve({ verifier, state: sdkState, location: consent, id: sdkId });
    check(sdkDecision.kind === 'redirect', 'SDK consent failed');
    const sdkCallback = new URL(sdkDecision.location);
    check(sdkCallback.searchParams.get('state') === sdkState, 'SDK state mismatch');
    await transport.finishAuth(sdkCallback.searchParams.get('code') ?? '');
    await sdk.close();
    await sdk.connect(
        new StreamableHTTPClientTransport(new URL(resource), { authProvider: provider, fetch: fixtureFetch }),
    );
    check((await sdk.listTools()).tools.length === 6, 'SDK tools contract failed');
    check(!(await sdk.callTool({ name: 'list_orders', arguments: {} })).isError, 'SDK authenticated read failed');
    check(
        (await sdk.callTool({ name: 'list_orders', arguments: { workspace_owner_id: b } })).isError,
        'SDK cross-roastery read succeeded',
    );
    const beforeRenewal = sdkTokens?.access_token ?? '';
    await admin`update private.mcp_tokens set expires_at=now()-interval '1 second',issued_at=now()-interval '1 hour' where hash=${await digest(beforeRenewal)}`;
    check((await sdk.listTools()).tools.length === 6, 'SDK could not recover from access expiry');
    check(sdkTokens?.access_token !== beforeRenewal, 'SDK did not use the rotating refresh flow');
    const sdkAccess = sdkTokens?.access_token ?? '';
    await admin`delete from public.organization_members where user_id=${a}::uuid and org_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`;
    check((await lookup(sdkAccess)) === null, 'Removed membership remained accessible');
    const legacyProof = await admin.begin(async (tx) => {
        await tx`set local role firstcrack_mcp_gateway`;
        await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
        const [row] = await tx`select private.mcp_access(${await digest(sdkAccess)},${issuer},${resource}) as result`;
        return row.result;
    });
    check(legacyProof === null, 'Legacy session GUC overrode the grant-bound user');
    const [{ count }] =
        await admin`select count(*)::integer as count from private.mcp_tokens where hash like 'fcmcp_%'`;
    check(count === 0, 'Plaintext bearer token stored');
    for (const role of ['firstcrack_mcp_issuer', 'firstcrack_mcp_gateway']) {
        let denied = false;
        try {
            await admin.begin(async (tx) => {
                await tx`select set_config('role',${role},true)`;
                await tx`select * from private.mcp_tokens`;
            });
        } catch (error) {
            denied = error instanceof postgres.PostgresError && error.code === '42501';
        }
        check(denied, 'Runtime role can enumerate token hashes');
    }
    for (const [role, query] of [
        [
            'firstcrack_mcp_issuer',
            "select private.mcp_access('fixture','https://identity.example/oauth/mcp','https://resource.example/mcp')",
        ],
        ['firstcrack_mcp_gateway', "select private.mcp_oauth('grants','{}'::jsonb)"],
        ['firstcrack_mcp_gateway', 'select * from public.roast_sessions'],
        ['firstcrack_mcp_data', 'select polar_customer_id from public.profiles'],
        ['firstcrack_mcp_data', "update public.beans set name='forbidden'"],
    ]) {
        let denied = false;
        try {
            await admin.begin(async (tx) => {
                await tx`select set_config('role',${role},true)`;
                await tx.unsafe(query);
            });
        } catch (error) {
            denied = error instanceof postgres.PostgresError && error.code === '42501';
        }
        check(denied, 'MCP database authority crossed its function/column/read boundary');
    }
    await Deno.stdout.write(
        new TextEncoder().encode(
            `PASS ${checks} checks: native identity + landing consent + independent OAuth + PostgreSQL RLS + SDK + expiry/rotation/revocation/isolation\n`,
        ),
    );
} finally {
    for (const client of clients) await client.close();
    globalThis.fetch = originalFetch;
    for (const [name, value] of oldEnv) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
    }
    await server.shutdown();
    await store.close();
    await gateway.close();
    await admin.end({ timeout: 1 });
}
