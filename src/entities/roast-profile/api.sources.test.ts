import type { RoastProfile } from '@shared/types/database.types';
import { beforeEach, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@shared/lib/supabase', () => ({ supabase: { rpc } }));

import { roastProfileApi } from './api';

beforeEach(() => rpc.mockReset());
it('commits profile metadata and multiple registered sources in a single RPC', async () => {
    const sources = [
        { bean_id: 'bean-1', blend_id: null },
        { bean_id: null, blend_id: 'blend-1' },
    ];
    rpc.mockResolvedValue({ data: { id: 'profile-1' }, error: null });
    await roastProfileApi.create({ user_id: 'owner', name: 'Multi', sources } as Omit<
        RoastProfile,
        'id' | 'created_at' | 'updated_at'
    > & { sources: typeof sources });
    expect(rpc).toHaveBeenCalledWith('save_roast_profile_sources', {
        p_profile: { user_id: 'owner', name: 'Multi' },
        p_sources: sources,
        p_id: undefined,
    });
    await roastProfileApi.update({ id: 'profile-1', name: 'Changed', sources: [] });
    expect(rpc).toHaveBeenLastCalledWith('save_roast_profile_sources', {
        p_profile: { name: 'Changed' },
        p_sources: [],
        p_id: 'profile-1',
    });
});
it('propagates an atomic source-save error', async () => {
    const error = { code: '42501', message: 'denied' };
    rpc.mockResolvedValue({ data: null, error });
    await expect(
        roastProfileApi.update({ id: 'profile-1', sources: [{ bean_id: 'foreign', blend_id: null }] }),
    ).rejects.toEqual(error);
});
