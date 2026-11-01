/** Cross-repo HTTP checks against the caller's disposable PostgreSQL fixture only. */
import { type Gateway, opaqueDependencies } from '../functions/_shared/mcp-oauth/access.ts';
import { pkce } from '../functions/_shared/mcp-oauth/crypto.ts';
import { createIssuerHandler } from '../functions/_shared/mcp-oauth/http.ts';
import type { IssuerService } from '../functions/_shared/mcp-oauth/service.ts';
import { createMcpHandler } from '../functions/firstcrack-mcp/server.ts';

export async function runWriteHttpChecks(service: IssuerService, gateway: Gateway): Promise<number> {
    const issuer = 'https://identity.example/oauth/mcp';
    const resource = 'https://resource.example/mcp';
    const project = 'https://native.example';
    const callback = 'https://host.example/callback';
    const member = '11111111-1111-4111-8111-111111111111';
    const owner = '22222222-2222-4222-8222-222222222222';
    const bean = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const combined = 'firstcrack:read firstcrack:write';
    if (service.config.issuer !== issuer || service.config.resource !== resource || !service.config.writeEnabled)
        throw new Error('Expected the isolated write-enabled fixture issuer');
    const root = Deno.env.get('MCP_TEST_LANDING_ROOT');
    const landing = root
        ? new URL(`${root.replace(/\/$/, '')}/`, `file://${Deno.cwd()}/`)
        : new URL('../../../fc-landing-mcp-write/', import.meta.url);
    if (landing.protocol !== 'file:') throw new Error('Landing fixture must be a local source checkout');
    const { CONSENT_COOKIE, handleMcpConsent } = await import(
        new URL('apps/landing/src/lib/mcpConsent.ts', landing).href
    );
    const { issuerConsentClient, proxyIssuerRequest } = await import(
        new URL('apps/landing/src/lib/mcpIssuer.ts', landing).href
    );
    const { proxyMcpRequest } = await import(new URL('apps/landing/src/lib/mcpProxy.ts', landing).href);
    let checks = 0;
    function check(value: unknown, message: string): asserts value {
        if (!value) throw new Error(`Write HTTP: ${message}`);
        checks++;
    }
    const mcpConfig = { issuer, resource, clientIds: ['fixture-client'], allowedOrigins: [], writeEnabled: true };
    const oauth = createIssuerHandler({
        service,
        identity: async (request) =>
            request.headers.get('Authorization') === 'Bearer fixture-native-proof'
                ? { userId: member, workspaces: [{ owner_id: owner, name: 'Fixture roastery' }] }
                : null,
    });
    const mcp = createMcpHandler({
        config: mcpConfig,
        ...opaqueDependencies(mcpConfig, gateway),
        reportError: async () => {
            throw new Error('Unexpected fixture write backend failure');
        },
    });
    let landingWriteEnabled = true;
    const native = {
        auth: {
            getUser: async () => ({ data: { user: { id: member } }, error: null }),
            getSession: async () => ({ data: { session: { access_token: 'fixture-native-proof' } }, error: null }),
        },
    };
    const originalFetch = globalThis.fetch;
    const allowedOrigins = ['https://identity.example', 'https://resource.example', project];
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async (incoming) => {
        const logical = incoming.headers.get('X-Fixture-URL');
        if (!logical || !allowedOrigins.includes(new URL(logical).origin))
            return new Response('Unknown fixture', { status: 400 });
        const request = new Request(logical, incoming);
        const url = new URL(logical);
        if (url.origin === project && url.pathname.startsWith('/functions/v1/firstcrack-oauth/')) return oauth(request);
        if (url.origin === project && url.pathname.startsWith('/functions/v1/firstcrack-mcp')) return mcp(request);
        if (url.origin === 'https://resource.example')
            return proxyMcpRequest(request, '', { enabled: true, project }, fixtureFetch);
        if (url.origin !== 'https://identity.example') return new Response('Unknown fixture', { status: 404 });
        if (url.pathname !== '/oauth/consent')
            return proxyIssuerRequest(
                request,
                url.pathname.split('/').at(-1) ?? '',
                { enabled: true, writeEnabled: landingWriteEnabled, issuer, project },
                fixtureFetch,
            );
        const authorization = url.searchParams.get('authorization_id') ?? '';
        const cookie = request.headers
            .get('Cookie')
            ?.split('; ')
            .find((value) => value.startsWith(`${CONSENT_COOKIE}=`));
        const form = request.method === 'POST' ? await request.formData() : undefined;
        const state = await handleMcpConsent(
            request,
            issuerConsentClient(native, project, fixtureFetch),
            {
                enabled: true,
                readOnlyReady: true,
                writeEnabled: landingWriteEnabled,
                issuer,
                resource,
                clientIds: ['fixture-client'],
                redirectUris: [callback],
            },
            cookie?.slice(CONSENT_COOKIE.length + 1),
            form,
        );
        const headers = new Headers();
        if (state.kind === 'review')
            headers.set(
                'Set-Cookie',
                `${CONSENT_COOKIE}=${authorization}.${crypto.randomUUID()}; HttpOnly; Secure; SameSite=Lax`,
            );
        return Response.json(state, { status: state.kind === 'unavailable' ? state.status : 200, headers });
    });
    const local = `http://127.0.0.1:${server.addr.port}`;
    function fixtureFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
        const request = new Request(input, init);
        const target = new URL(request.url);
        if (!allowedOrigins.includes(target.origin)) throw new Error('Non-fixture HTTP destination refused');
        const forwarded = new Request(new URL(`${target.pathname}${target.search}`, local), request);
        forwarded.headers.set('X-Fixture-URL', request.url);
        return originalFetch(forwarded);
    }
    async function connect(scope: string, checked: boolean) {
        const verifier = 'h'.repeat(64);
        const params = new URLSearchParams({
            client_id: 'fixture-client',
            redirect_uri: callback,
            response_type: 'code',
            scope,
            state: crypto.randomUUID(),
            code_challenge: await pkce(verifier),
            code_challenge_method: 'S256',
            resource,
        });
        const authorization = await fixtureFetch(`${issuer}/authorize?${params}`, { redirect: 'manual' });
        check(authorization.status === 303, 'authorization reaches landing consent through the HTTP proxy');
        const location = authorization.headers.get('Location') ?? '';
        const reviewResponse = await fixtureFetch(location);
        const review = await reviewResponse.json();
        check(
            review.kind === 'review' && review.writeRequested === (scope === combined),
            'consent reviews requested permissions',
        );
        const cookie = reviewResponse.headers.get('Set-Cookie')?.split(';')[0] ?? '';
        const form = new FormData();
        form.set('csrf', cookie.slice(CONSENT_COOKIE.length + 1));
        form.set('workspace_owner_id', owner);
        form.set('decision', 'approve');
        if (checked) form.set('allow_write', 'true');
        const decisionResponse = await fixtureFetch(location, {
            method: 'POST',
            headers: { Origin: 'https://identity.example', Cookie: cookie },
            body: form,
        });
        const decision = await decisionResponse.json();
        check(
            decision.kind === 'redirect',
            'explicit same-origin consent approves through the internal issuer HTTP endpoint',
        );
        const redirect = new URL(decision.location);
        check(
            redirect.searchParams.get('state') === params.get('state') && redirect.searchParams.get('iss') === issuer,
            'callback preserves state and issuer',
        );
        const response = await fixtureFetch(`${issuer}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: 'fixture-client',
                redirect_uri: callback,
                code: redirect.searchParams.get('code') ?? '',
                code_verifier: verifier,
                resource,
            }),
        });
        const token = await response.json();
        check(
            response.status === 200 && /^fcmcp_at_[A-Za-z0-9_-]{43}$/.test(token.access_token),
            'HTTP token proxy returns opaque MCP credentials',
        );
        return token;
    }
    const rpc = async (access: string, method: string, params: Record<string, unknown> = {}) => {
        const response = await fixtureFetch(resource, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${access}`,
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                'MCP-Protocol-Version': '2025-06-18',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        return response.json();
    };
    const receipt = {
        request_id: crypto.randomUUID(),
        reason: 'isolated cross-repo HTTP fixture',
        bean_id: bean,
        quantity_g: 10,
    };
    try {
        const page = await Deno.readTextFile(new URL('apps/landing/src/pages/oauth/consent.astro', landing));
        const checkbox = page.match(/<input[^>]*id="allow-write"[^>]*>/)?.[0];
        check(
            checkbox && !/\bchecked\b|\brequired\b/.test(checkbox),
            'write checkbox source starts unchecked and optional',
        );
        const rw = await connect(combined, true);
        check(rw.scope === combined, 'checked consent grants canonical read/write scope');
        const listed = await rpc(rw.access_token, 'tools/list');
        check(
            listed.result.tools.filter(
                (tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint === false,
            ).length === 6,
            'write grant exposes six inventory/production tools over HTTP',
        );
        const stockBefore = await rpc(rw.access_token, 'tools/call', {
            name: 'list_green_stock',
            arguments: { limit: 100 },
        });
        const initialGrams = stockBefore.result.structuredContent.items.find(
            (item: { id: string }) => item.id === bean,
        )?.on_hand_grams;
        if (typeof initialGrams !== 'number') throw new Error('Fixture green stock was not readable');
        const received = await rpc(rw.access_token, 'tools/call', { name: 'receive_green_stock', arguments: receipt });
        check(
            received.result && !received.result.isError && received.result.structuredContent,
            'HTTP green receipt reaches the real transactional write gateway',
        );
        const repeated = await rpc(rw.access_token, 'tools/call', { name: 'receive_green_stock', arguments: receipt });
        check(
            JSON.stringify(repeated.result.structuredContent) === JSON.stringify(received.result.structuredContent),
            'HTTP retry returns the same receipt',
        );
        const stockAfter = await rpc(rw.access_token, 'tools/call', {
            name: 'list_green_stock',
            arguments: { limit: 100 },
        });
        check(
            stockAfter.result.structuredContent.items.find((item: { id: string }) => item.id === bean)
                ?.on_hand_grams ===
                initialGrams + 10,
            'HTTP receipt and retry increase visible stock by exactly ten grams',
        );
        const ro = await connect(combined, false);
        check(ro.scope === 'firstcrack:read', 'unchecked approval reduces the requested write scope');
        check(
            (await rpc(ro.access_token, 'tools/call', { name: 'receive_green_stock', arguments: receipt })).result
                .isError,
            'unchecked approval cannot call a write tool',
        );
        const expansion = await fixtureFetch(`${issuer}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: 'fixture-client',
                refresh_token: ro.refresh_token,
                resource,
                scope: combined,
            }),
        });
        check(
            expansion.status === 400 && (await expansion.json()).error === 'invalid_scope',
            'read refresh cannot expand scope over HTTP',
        );
        landingWriteEnabled = false;
        const refreshed = await fixtureFetch(`${issuer}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: 'fixture-client',
                refresh_token: rw.refresh_token,
                resource,
            }),
        });
        const rotated = await refreshed.json();
        check(
            refreshed.status === 200 && rotated.scope === combined,
            'disabling new landing consent preserves existing rotated credentials',
        );
        mcpConfig.writeEnabled = false;
        check(
            (await rpc(rotated.access_token, 'tools/call', { name: 'receive_green_stock', arguments: receipt })).result
                .isError,
            'MCP execution flag blocks previously consented writes',
        );
        const readonlyList = await rpc(rotated.access_token, 'tools/list');
        check(
            readonlyList.result.tools.every(
                (tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint,
            ),
            'disabled execution gate exposes only read tools',
        );
        return checks;
    } finally {
        await server.shutdown();
    }
}
