import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../firstcrack-mcp/test-fixtures.ts';
import { type Gateway, opaqueDependencies } from './access.ts';
import { digest, opaque } from './crypto.ts';

const write = vi.fn<NonNullable<Gateway['write']>>();
const gateway: Gateway = { access: vi.fn(async () => null), read: vi.fn(async () => ({})), write };
const args = {
    request_id: '11111111-1111-4111-8111-111111111111',
    bean_id: '22222222-2222-4222-8222-222222222222',
    quantity_g: 100,
    reason: 'delivery',
};
const req = (token: string) => new Request(config.resource, { headers: { Authorization: `Bearer ${token}` } });
beforeEach(() => {
    vi.clearAllMocks();
    write.mockResolvedValue({ result: { request_id: args.request_id } });
});

describe('opaque write gateway boundary', () => {
    it('sends a hash with issuer/resource binding instead of exposing the access token to SQL', async () => {
        const token = opaque('at');
        const client = opaqueDependencies({ ...config, writeEnabled: true }, gateway).writeClient(req(token));
        expect(await client.executeWrite('receive_green_stock', args)).toMatchObject({
            result: { request_id: args.request_id },
        });
        expect(write).toHaveBeenCalledExactlyOnceWith(
            await digest(token),
            config.issuer,
            config.resource,
            'receive_green_stock',
            args,
        );
        expect(JSON.stringify(write.mock.calls)).not.toContain(token);
    });
    it('never calls write storage when the independent gate is off', async () => {
        const client = opaqueDependencies(config, gateway).writeClient(req(opaque('at')));
        expect(await client.executeWrite('receive_green_stock', args)).toEqual({ error: 'insufficient_scope' });
        expect(write).not.toHaveBeenCalled();
    });
    it.each(['native.jwt.fixture', '', 'fc_mcp_rt_invalid'])(
        'never sends a native or invalid credential to write storage: %s',
        async (token) => {
            const client = opaqueDependencies({ ...config, writeEnabled: true }, gateway).writeClient(req(token));
            expect(await client.executeWrite('receive_green_stock', args)).toEqual({ error: 'insufficient_scope' });
            expect(write).not.toHaveBeenCalled();
        },
    );
    it('propagates current grant revocation and scope denial from transactional storage', async () => {
        const client = opaqueDependencies({ ...config, writeEnabled: true }, gateway).writeClient(req(opaque('at')));
        for (const error of ['invalid_token', 'insufficient_scope', 'access_denied']) {
            write.mockResolvedValue({ error });
            expect(await client.executeWrite('receive_green_stock', args)).toEqual({ error });
        }
    });
});
