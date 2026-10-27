import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifiedClaims } from './auth.ts';
import type { ReadClient } from './data.ts';
import { createMcpHandler } from './server.ts';
import { config, memberId, otherOwnerId, ownerId, validClaims } from './test-fixtures.ts';

const select = vi.fn();
const eq = vi.fn();
const range = vi.fn();
let databaseResult: { data: unknown; error: unknown };
const from = vi.fn();
const selectRows = vi.fn<ReadClient['selectRows']>(async ({ table, columns, ownerColumn, ownerId, offset, limit }) => {
    from(table);
    select(table, columns);
    eq(table, ownerColumn, ownerId);
    range(offset, offset + limit);
    return databaseResult;
});
const access = vi.fn<ReadClient['hasWorkspaceAccess']>();
const verify = vi.fn<(req: Request, token: string) => Promise<VerifiedClaims | null>>();
const userClient = vi.fn(() => ({ selectRows, hasWorkspaceAccess: access }));
const reportError = vi.fn<(error: unknown) => Promise<void>>();
const handler = createMcpHandler({ config, verify, userClient, reportError });
const headers = {
    Authorization: 'Bearer test-credential',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
};

function request(method: string, params: unknown = {}, overrides: Record<string, string> = {}) {
    return handler(
        new Request(config.resource, {
            method: 'POST',
            headers: { ...headers, ...overrides },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
    );
}
const call = (name: string, args: unknown = {}) => request('tools/call', { name, arguments: args });

beforeEach(() => {
    vi.clearAllMocks();
    verify.mockResolvedValue(validClaims());
    access.mockResolvedValue({ data: true, error: null });
    databaseResult = { data: [{ id: 'test-row' }], error: null };
});

describe('HTTP authentication and discovery', () => {
    it('publishes protected-resource discovery without an access token', async () => {
        const response = await handler(new Request(`${config.resource}/.well-known/oauth-protected-resource`));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            resource: config.resource,
            authorization_servers: [config.issuer],
        });
        expect(verify).not.toHaveBeenCalled();
        expect(userClient).not.toHaveBeenCalled();
    });

    it('serves the function path when the public resource is on the first-party host', async () => {
        const hosted = createMcpHandler({
            config: { ...config, resource: 'https://firstcrackiscoming.com/mcp' },
            verify,
            userClient,
            reportError,
        });
        const response = await hosted(new Request('http://worker/firstcrack-mcp', { method: 'POST' }));
        expect(response.status).toBe(401);
        expect(response.headers.get('WWW-Authenticate')).toContain(
            'https://firstcrackiscoming.com/mcp/.well-known/oauth-protected-resource',
        );
    });

    it('supports the path forwarded by the Supabase gateway', async () => {
        const response = await handler(
            new Request('http://worker/firstcrack-mcp/.well-known/oauth-protected-resource'),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ resource: config.resource });
    });

    it('challenges a missing credential using an explicit discovery URL', async () => {
        const response = await request('tools/list', {}, { Authorization: '' });
        expect(response.status).toBe(401);
        expect(response.headers.get('WWW-Authenticate')).toContain(
            `${config.resource}/.well-known/oauth-protected-resource`,
        );
        expect(verify).not.toHaveBeenCalled();
        expect(from).not.toHaveBeenCalled();
    });

    it('rejects a token rejected by the signature/identity verifier, without sample fallback', async () => {
        verify.mockResolvedValue(null);
        const response = await call('list_orders');
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'invalid_token' });
        expect(userClient).not.toHaveBeenCalled();
    });

    it('rejects expiry on a later request using the same connection', async () => {
        expect((await call('list_orders')).status).toBe(200);
        verify.mockResolvedValue({ ...validClaims(), exp: 1 });
        expect((await call('list_orders')).status).toBe(401);
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('returns an insufficient-scope challenge and refuses a native user token', async () => {
        verify.mockResolvedValue({ ...validClaims(), scope: 'profile' });
        const response = await call('list_orders');
        expect(response.status).toBe(403);
        expect(response.headers.get('WWW-Authenticate')).toContain('insufficient_scope');
        verify.mockResolvedValue({ ...validClaims(), role: 'authenticated' });
        expect((await call('list_orders')).status).toBe(401);
        expect(from).not.toHaveBeenCalled();
    });

    it('is disabled until reviewed configuration is explicitly enabled', async () => {
        const disabled = createMcpHandler({ config: null, verify, userClient, reportError });
        expect((await disabled(new Request(config.resource))).status).toBe(503);
        expect(verify).not.toHaveBeenCalled();
    });

    it('rejects unexpected origins before authentication and uses no-store responses', async () => {
        expect((await request('ping', {}, { Origin: 'https://untrusted.example' })).status).toBe(403);
        expect(verify).not.toHaveBeenCalled();
        const response = await request('ping', {}, { Origin: 'https://host.example' });
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://host.example');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
    });
});

describe('MCP protocol', () => {
    it('initializes and lists six read-only stock and order tools', async () => {
        const response = await request('initialize', { protocolVersion: '2025-06-18' });
        expect(await response.json()).toMatchObject({
            result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
        });
        const list = await (await request('tools/list')).json();
        expect(list.result.tools).toHaveLength(6);
        expect(list.result.tools.map((tool: { name: string }) => tool.name)).toContain('list_green_stock');
        for (const tool of list.result.tools) expect(tool.annotations.readOnlyHint).toBe(true);
        expect(from).not.toHaveBeenCalled();
    });

    it('accepts notifications without executing tools', async () => {
        const response = await handler(
            new Request(config.resource, {
                method: 'POST',
                headers,
                body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'list_orders' } }),
            }),
        );
        expect(response.status).toBe(202);
        expect(await response.text()).toBe('');
        expect(from).not.toHaveBeenCalled();
    });

    it('rejects write tools and arbitrary method names', async () => {
        expect(await (await call('register_production')).json()).toMatchObject({ error: { code: -32602 } });
        expect(await (await request('inventory/update')).json()).toMatchObject({ error: { code: -32601 } });
        expect(from).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON, batches, oversized bodies and unsupported transport headers', async () => {
        for (const body of ['{', '[]']) {
            expect((await handler(new Request(config.resource, { method: 'POST', headers, body }))).status).toBe(400);
        }
        expect(
            (await handler(new Request(config.resource, { method: 'POST', headers, body: ' '.repeat(65537) }))).status,
        ).toBe(413);
        expect((await request('ping', {}, { Accept: 'application/json' })).status).toBe(406);
        expect((await request('ping', {}, { 'Content-Type': 'text/plain' })).status).toBe(415);
        expect((await request('ping', {}, { 'MCP-Protocol-Version': 'unknown' })).status).toBe(400);
    });
});

describe('account and roastery isolation', () => {
    it('reads owner rows for a member, preserving the authenticated user identity', async () => {
        const response = await call('list_green_stock');
        expect(await response.json()).toMatchObject({
            result: { structuredContent: { mode: 'live', items: [{ id: 'test-row' }] } },
        });
        expect(access).toHaveBeenCalledWith(ownerId);
        expect(eq).toHaveBeenCalledWith('beans', 'user_id', ownerId);
        expect(eq).not.toHaveBeenCalledWith('beans', 'user_id', memberId);
    });

    it('keeps the personal profile scoped to the token subject', async () => {
        await call('get_my_profile');
        expect(eq).toHaveBeenCalledWith('profiles', 'id', memberId);
    });

    it('returns only the workspace selected at connection time', async () => {
        await call('list_my_workspaces');
        expect(eq).toHaveBeenCalledWith('organizations', 'owner_id', ownerId);
    });

    it('refuses a different workspace even if the user is also a member there', async () => {
        const response = await call('list_orders', { workspace_owner_id: otherOwnerId });
        expect(await response.json()).toMatchObject({ result: { isError: true } });
        expect(from).not.toHaveBeenCalled();
        expect(access).not.toHaveBeenCalled();
    });

    it('checks membership again after a member is removed', async () => {
        await call('list_orders');
        access.mockResolvedValue({ data: false, error: null });
        const response = await call('list_orders');
        expect(await response.json()).toMatchObject({ result: { isError: true } });
        expect(access).toHaveBeenCalledTimes(2);
        expect(from).toHaveBeenCalledTimes(1);
    });

    it('refuses a non-member and fails closed on a permission lookup error', async () => {
        for (const result of [
            { data: false, error: null },
            { data: null, error: { message: 'private database detail' } },
        ]) {
            access.mockResolvedValue(result);
            const response = await call('list_product_stock');
            const body = await response.text();
            expect(body).toContain('isError');
            expect(body).not.toContain('private database detail');
        }
        expect(from).not.toHaveBeenCalled();
    });

    it.each([{ user_id: otherOwnerId }, { limit: 101 }, { offset: -1 }, { workspace_owner_id: 'invalid' }])(
        'rejects invalid arguments before querying: %j',
        async (args) => {
            expect(await (await call('list_orders', args)).json()).toMatchObject({ error: { code: -32602 } });
            expect(from).not.toHaveBeenCalled();
        },
    );

    it('uses explicit safe projections and bounded pagination', async () => {
        databaseResult = { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null };
        const response = await call('list_orders', { limit: 2, offset: 5 });
        expect(await response.json()).toMatchObject({
            result: { structuredContent: { items: [{ id: 'a' }, { id: 'b' }], next_offset: 7 } },
        });
        expect(range).toHaveBeenCalledWith(5, 7);
        const projection = select.mock.calls[0][1];
        expect(projection).not.toContain('*');
        expect(projection).not.toContain('raw');
        expect(projection).not.toContain('buyer_name');
    });

    it('returns a safe error rather than sample data or raw database errors', async () => {
        databaseResult = { data: null, error: { message: 'private database detail' } };
        const response = await call('list_orders');
        const body = await response.text();
        expect(body).toContain('isError');
        expect(body).not.toContain('private database detail');
        expect(body).not.toContain('sample');
        expect(body).not.toContain('items');
        expect(reportError).toHaveBeenCalledOnce();
    });
});
