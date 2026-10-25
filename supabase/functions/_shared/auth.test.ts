import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn() }));
vi.mock('npm:@supabase/supabase-js@2', () => ({
    createClient: () => ({ auth: mocks }),
}));

import { getAuthenticatedUser } from './auth.ts';

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Deno', { env: { get: () => 'test-only' } });
    mocks.getClaims.mockResolvedValue({ data: { claims: { role: 'authenticated' } }, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'member' } }, error: null });
});

describe('privileged Edge Function authentication boundary', () => {
    const request = () =>
        new Request('https://project.example/function', { headers: { Authorization: 'Bearer test-token' } });

    it('preserves native desktop sessions', async () => {
        expect(await getAuthenticatedUser(request())).toEqual({ id: 'member' });
        expect(mocks.getClaims).toHaveBeenCalledWith('test-token');
        expect(mocks.getUser).toHaveBeenCalledOnce();
    });

    it.each([
        { role: 'firstcrack_reader', client_id: 'approved-client', scope: 'firstcrack:read' },
        { role: 'authenticated', client_id: 'oauth-client' },
        { role: 'service_role' },
    ])('blocks integration and privileged tokens before a handler can write: %j', async (claims) => {
        mocks.getClaims.mockResolvedValue({ data: { claims }, error: null });
        expect(await getAuthenticatedUser(request())).toBeNull();
        expect(mocks.getUser).not.toHaveBeenCalled();
    });

    it('refuses expired, invalid or missing tokens', async () => {
        mocks.getClaims.mockResolvedValue({ data: null, error: new Error('invalid token') });
        expect(await getAuthenticatedUser(request())).toBeNull();
        expect(await getAuthenticatedUser(new Request('https://project.example/function'))).toBeNull();
        expect(mocks.getUser).not.toHaveBeenCalled();
    });

    it('treats thrown SDK expiry errors as authentication failures', async () => {
        mocks.getClaims.mockRejectedValue(new Error('JWT has expired'));
        expect(await getAuthenticatedUser(request())).toBeNull();
        expect(mocks.getUser).not.toHaveBeenCalled();
    });
});
