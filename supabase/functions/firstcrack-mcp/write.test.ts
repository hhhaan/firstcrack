import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeClaims, READ_SCOPE, WRITE_SCOPE } from './auth.ts';
import { createMcpHandler } from './server.ts';
import { config, memberId, ownerId, validClaims } from './test-fixtures.ts';
import { writeTools } from './write.ts';

const requestId = '44444444-4444-4444-8444-444444444444';
const productionId = '55555555-5555-4555-8555-555555555555';
const common = { request_id: requestId, reason: 'stock count correction' };
const timestamp = '2026-11-01T09:00:00+09:00';
const examples = [
    ['receive_green_stock', { ...common, bean_id: ownerId, quantity_g: 1000, unit_cost_per_kg: 10.5 }],
    ['adjust_green_stock', { ...common, bean_id: ownerId, delta_g: -100 }],
    ['adjust_roasted_stock', { ...common, bean_id: ownerId, delta_g: 100 }],
    ['adjust_product_stock', { ...common, product_id: ownerId, delta: -1 }],
    [
        'record_roast_production',
        {
            ...common,
            production_id: productionId,
            bean_id: ownerId,
            input_weight_g: 1000,
            output_weight_g: 850,
            roasted_at: timestamp,
        },
    ],
    [
        'record_packaging_production',
        { ...common, production_id: productionId, product_id: ownerId, quantity: 2, packaged_at: timestamp },
    ],
] as const;
const executeWrite = vi.fn(
    async (_tool: string, _args: Record<string, unknown>): Promise<Record<string, unknown>> => ({
        result: { request_id: requestId },
    }),
);
const reportError = vi.fn(async () => {});
const claims = () => ({ ...validClaims(), scope: `${READ_SCOPE} ${WRITE_SCOPE}` });
function handler({ enabled = true, scope = `${READ_SCOPE} ${WRITE_SCOPE}` } = {}) {
    return createMcpHandler({
        config: { ...config, writeEnabled: enabled },
        verify: async () => ({ ...claims(), scope }),
        userClient: () => ({
            hasWorkspaceAccess: async () => ({ data: true, error: null }),
            selectRows: async () => ({ data: [], error: null }),
        }),
        writeClient: () => ({ executeWrite }),
        reportError,
    });
}
async function invoke(method: string, params: unknown = {}, options = {}) {
    const response = await handler(options)(
        new Request(config.resource, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer fixture-token',
                Accept: 'application/json, text/event-stream',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
    );
    return response.json();
}
const call = (name: string, args: unknown, options = {}) => invoke('tools/call', { name, arguments: args }, options);

beforeEach(() => {
    vi.clearAllMocks();
    executeWrite.mockResolvedValue({ result: { request_id: requestId } });
});

describe('inventory and production write permissions', () => {
    it('requires both the authoritative write scope and the independent activation gate', async () => {
        for (const options of [{ enabled: false }, { scope: READ_SCOPE }, { enabled: false, scope: READ_SCOPE }]) {
            const list = await invoke('tools/list', {}, options);
            expect(list.result.tools).toHaveLength(6);
            expect(await call(examples[0][0], examples[0][1], options)).toMatchObject({ result: { isError: true } });
        }
        expect(executeWrite).not.toHaveBeenCalled();
    });
    it('exposes only the six bounded writes with explicit write scopes and destructive hints', async () => {
        const list = await invoke('tools/list');
        expect(list.result.tools).toHaveLength(12);
        expect(writeTools.map((tool) => tool.name)).toEqual(examples.map(([name]) => name));
        for (const tool of writeTools) {
            expect(tool.annotations).toMatchObject({
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
            });
            expect(tool.securitySchemes[0].scopes).toEqual([READ_SCOPE, WRITE_SCOPE]);
            expect(tool.inputSchema.additionalProperties).toBe(false);
            expect(tool.inputSchema.required).toEqual(expect.arrayContaining(['request_id', 'reason']));
        }
    });
    it('preserves the selected owner and authenticated identity in a scoped write principal', () => {
        expect(authorizeClaims(claims(), { ...config, writeEnabled: true })).toEqual({
            principal: { userId: memberId, clientId: 'approved-client', workspaceOwnerId: ownerId, canWrite: true },
        });
        expect(authorizeClaims(claims(), config)).toMatchObject({ principal: { workspaceOwnerId: ownerId } });
        expect(
            authorizeClaims({ ...claims(), role: 'authenticated' }, { ...config, writeEnabled: true }),
        ).toMatchObject({ status: 401 });
    });
    it.each(examples)('executes the validated %s through its single transactional gateway', async (name, args) => {
        expect(await call(name, args)).toMatchObject({ result: { structuredContent: { request_id: requestId } } });
        expect(executeWrite).toHaveBeenCalledExactlyOnceWith(name, args);
    });
    it.each([
        { request_id: 'bad' },
        { request_id: undefined },
        { reason: '' },
        { reason: '   ' },
        { reason: 'x'.repeat(501) },
        { workspace_owner_id: memberId },
        { user_id: memberId },
        { sql: 'delete from beans' },
        { bean_id: 'bad' },
        { quantity_g: 0 },
        { quantity_g: -1 },
        { quantity_g: 0.5 },
        { quantity_g: 1e9 + 1 },
        { unit_cost_per_kg: -1 },
    ])('rejects invalid receiving input without touching the database: %j', async (change) => {
        expect(await call('receive_green_stock', { ...examples[0][1], ...change })).toMatchObject({
            error: { code: -32602 },
        });
        expect(executeWrite).not.toHaveBeenCalled();
    });
    it.each([
        ['adjust_green_stock', { ...examples[1][1], delta_g: 0 }],
        ['adjust_roasted_stock', { ...examples[2][1], delta_g: 0.5 }],
        ['adjust_product_stock', { ...examples[3][1], delta: 0.5 }],
        ['record_roast_production', { ...examples[4][1], output_weight_g: 1001 }],
        ['record_roast_production', { ...examples[4][1], production_id: 'bad' }],
        ['record_roast_production', { ...examples[4][1], roasted_at: '2026-11-01T09:00:00' }],
        ['record_roast_production', { ...examples[4][1], roasted_at: '2026-02-30T09:00:00Z' }],
        ['record_packaging_production', { ...examples[5][1], quantity: 0 }],
        ['record_packaging_production', { ...examples[5][1], quantity: 1.5 }],
        ['record_packaging_production', { ...examples[5][1], packaged_at: 'yesterday' }],
    ])('rejects invalid %s production or adjustment', async (name, args) => {
        expect(await call(name, args)).toMatchObject({ error: { code: -32602 } });
        expect(executeWrite).not.toHaveBeenCalled();
    });
    it('normalizes audit reason whitespace while retaining the retry request ID', async () => {
        await call('receive_green_stock', { ...examples[0][1], reason: '  counted today  ' });
        expect(executeWrite).toHaveBeenCalledWith('receive_green_stock', {
            ...examples[0][1],
            reason: 'counted today',
        });
    });
    it.each([
        'invalid_token',
        'insufficient_scope',
        'access_denied',
        'invalid_arguments',
        'insufficient_stock',
        'inventory_busy',
        'idempotency_conflict',
        'production_exists',
        'insufficient_plan',
    ])('returns safe expected storage error %s without reporting it as a server failure', async (error) => {
        executeWrite.mockResolvedValue({ error, detail: 'private database detail' });
        const response = await call(examples[0][0], examples[0][1]);
        expect(response).toMatchObject({ result: { isError: true } });
        expect(JSON.stringify(response)).not.toContain('private database detail');
        expect(reportError).not.toHaveBeenCalled();
    });
    it('reports an unexpected storage response once without exposing database detail', async () => {
        executeWrite.mockResolvedValue({ error: 'internal SQL detail' });
        const response = await call(examples[0][0], examples[0][1]);
        expect(response).toMatchObject({ result: { isError: true } });
        expect(JSON.stringify(response)).not.toContain('internal SQL detail');
        expect(reportError).toHaveBeenCalledOnce();
    });
});
