/** Local protocol fixture only: no hosted clients, accounts or grants are created. */

import type { OAuthClientProvider } from 'npm:@modelcontextprotocol/sdk@1.32.2/client/auth.js';
import { Client } from 'npm:@modelcontextprotocol/sdk@1.32.2/client/index.js';
import { StreamableHTTPClientTransport } from 'npm:@modelcontextprotocol/sdk@1.32.2/client/streamableHttp.js';
import type { OAuthTokens } from 'npm:@modelcontextprotocol/sdk@1.32.2/shared/auth.js';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createMcpHandler } from '../functions/firstcrack-mcp/server.ts';
import { verifySupabaseToken } from '../functions/firstcrack-mcp/verify.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const clientId = '44444444-4444-4444-8444-444444444444';
const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', key.publicKey);
const encode = (value: Uint8Array | string) =>
    btoa(typeof value === 'string' ? value : String.fromCharCode(...value))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
const challenge = async (value: string) =>
    encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}

let base = '';
let resource = '';
let handler: (req: Request) => Promise<Response>;
let queryCount = 0;
let discoveredResource = false;
let discoveredIssuer = false;
const codes = new Map<string, { challenge: string; redirect: string }>();
let pending: { challenge: string; redirect: string; state: string } | undefined;
async function issueToken() {
    const now = Math.floor(Date.now() / 1000);
    const input = `${encode(JSON.stringify({ alg: 'ES256', kid: 'fixture-key', typ: 'JWT' }))}.${encode(
        JSON.stringify({
            iss: `${base}/auth/v1`,
            aud: ['authenticated', resource],
            sub: userId,
            role: 'firstcrack_reader',
            client_id: clientId,
            scope: 'openid',
            firstcrack_access: 'read',
            firstcrack_workspace_owner_id: userId,
            iat: now,
            exp: now + 300,
        }),
    )}`;
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key.privateKey,
        new TextEncoder().encode(input),
    );
    return `${input}.${encode(new Uint8Array(signature))}`;
}
const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/mcp')) {
        if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) discoveredResource = true;
        return handler(req);
    }
    if (url.pathname === '/.well-known/oauth-authorization-server/auth/v1') {
        discoveredIssuer = true;
        return Response.json({
            issuer: `${base}/auth/v1`,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            scopes_supported: ['openid'],
        });
    }
    if (url.pathname === '/auth/v1/.well-known/jwks.json')
        return Response.json({ keys: [{ ...jwk, kid: 'fixture-key', alg: 'ES256', use: 'sig' }] });
    if (url.pathname === '/auth/v1/user') return Response.json({ id: userId, is_anonymous: false });
    if (url.pathname === '/authorize') {
        check(url.searchParams.get('client_id') === clientId, 'Unexpected fixture client');
        check(url.searchParams.get('code_challenge_method') === 'S256', 'S256 PKCE required');
        check(url.searchParams.get('resource') === resource, 'OAuth resource binding missing');
        pending = {
            challenge: url.searchParams.get('code_challenge') ?? '',
            redirect: url.searchParams.get('redirect_uri') ?? '',
            state: url.searchParams.get('state') ?? '',
        };
        check(pending.redirect === `${base}/callback`, 'Unexpected fixture redirect');
        return new Response('Local fixture requires an explicit approve POST', { status: 200 });
    }
    if (url.pathname === '/fixture-consent' && req.method === 'POST') {
        check(pending, 'Missing fixture authorization');
        const code = crypto.randomUUID();
        codes.set(code, pending);
        const target = new URL(pending.redirect);
        target.searchParams.set('code', code);
        target.searchParams.set('state', pending.state);
        pending = undefined;
        return Response.redirect(target.href, 303);
    }
    if (url.pathname === '/token') {
        const form = await req.formData();
        const code = String(form.get('code'));
        const approved = codes.get(code);
        if (
            !approved ||
            form.get('client_id') !== clientId ||
            form.get('redirect_uri') !== approved.redirect ||
            (await challenge(String(form.get('code_verifier')))) !== approved.challenge ||
            form.get('resource') !== resource
        ) {
            return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        codes.delete(code);
        return Response.json({
            access_token: await issueToken(),
            token_type: 'Bearer',
            expires_in: 300,
            scope: 'openid',
        });
    }
    return new Response('Not found', { status: 404 });
});
base = `http://127.0.0.1:${server.addr.port}`;
resource = `${base}/mcp`;
const auth = createClient(base, 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}).auth;
handler = createMcpHandler({
    config: { resource, issuer: `${base}/auth/v1`, clientIds: [clientId], allowedOrigins: [] },
    verify: (_req, token) => verifySupabaseToken(auth, token),
    userClient: () => ({
        hasWorkspaceAccess: async (ownerId) => ({ data: ownerId === userId, error: null }),
        selectRows: async ({ ownerId }) => {
            queryCount++;
            check(ownerId === userId, 'Workspace scope escaped');
            return { data: [{ id: 'fixture-roast' }], error: null };
        },
    }),
    reportError: async () => {
        throw new Error('Unexpected fixture database error');
    },
});
let tokens: OAuthTokens | undefined;
let verifier = '';
let authorizationUrl: URL | undefined;
const state = crypto.randomUUID();
const provider: OAuthClientProvider = {
    redirectUrl: `${base}/callback`,
    clientMetadata: {
        redirect_uris: [`${base}/callback`],
        client_name: 'Local protocol fixture',
        scope: 'openid',
        token_endpoint_auth_method: 'none',
    },
    clientInformation: () => ({ client_id: clientId }),
    tokens: () => tokens,
    saveTokens: (value: OAuthTokens) => {
        tokens = value;
    },
    redirectToAuthorization: (url: URL) => {
        authorizationUrl = url;
    },
    saveCodeVerifier: (value: string) => {
        verifier = value;
    },
    codeVerifier: () => verifier,
    state: () => state,
};
const client = new Client({ name: 'firstcrack-protocol-check', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(resource), { authProvider: provider });
try {
    try {
        await client.connect(transport);
    } catch {
        /* Expected OAuth redirect before connection. */
    }
    check(authorizationUrl, 'SDK did not begin OAuth');
    check(discoveredResource && discoveredIssuer, 'SDK metadata discovery did not complete');
    await fetch(authorizationUrl);
    const approved = await fetch(`${base}/fixture-consent`, { method: 'POST', redirect: 'manual' });
    const callback = new URL(approved.headers.get('Location') ?? '');
    check(callback.searchParams.get('state') === state, 'OAuth state mismatch');
    const code = callback.searchParams.get('code');
    check(code, 'Missing local authorization code');
    const invalid = await fetch(`${base}/token`, {
        method: 'POST',
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            redirect_uri: `${base}/callback`,
            code_verifier: 'incorrect-verifier',
            resource,
        }),
    });
    check(invalid.status === 400, 'Wrong PKCE verifier accepted');
    await transport.finishAuth(code);
    await client.close();
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { authProvider: provider }));
    const listed = await client.listTools();
    check(listed.tools.length === 7, 'Unexpected tool count');
    const result = await client.callTool({ name: 'list_roast_sessions', arguments: {} });
    check(!result.isError && queryCount === 1, 'Authenticated fixture read failed');
    const blocked = await client.callTool({
        name: 'list_roast_sessions',
        arguments: { workspace_owner_id: '22222222-2222-4222-8222-222222222222' },
    });
    check(blocked.isError && queryCount === 1, 'Foreign workspace was queried');
    await Deno.stdout.write(
        new TextEncoder().encode(
            'PASS: MCP SDK discovery, S256 PKCE, code exchange, initialize, 7 tools, authenticated read, workspace denial\n',
        ),
    );
} finally {
    await client.close();
    await server.shutdown();
}
