// @vitest-environment jsdom
import type { RoastProfile } from '@shared/types/database.types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { type RoastProfileWithSource, roastProfileApi } from './api';
import {
    applyCreatedRoastProfileCache,
    applyUpdatedRoastProfileCache,
    roastProfileKeys,
    useCreateRoastProfile,
    useUpdateRoastProfile,
} from './queries';

vi.mock('./api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./api')>();
    return {
        ...actual,
        roastProfileApi: {
            ...actual.roastProfileApi,
            create: vi.fn(),
            update: vi.fn(),
        },
    };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uid = 'user-1';

const profile = (overrides: Partial<RoastProfile> = {}): RoastProfile =>
    ({
        id: 'p1',
        user_id: uid,
        name: 'Old name',
        description: null,
        target_level: 'Medium',
        charge_temp_celsius: 200,
        drop_temp_celsius: 210,
        duration_sec: 720,
        dev_time_sec: 120,
        dev_pct: 16.7,
        source_session_id: 's1',
        default_bean_id: null,
        default_blend_id: null,
        machine_id: null,
        machine_name: null,
        machine_brand: null,
        machine_roaster_key: null,
        machine_protocol: null,
        created_at: '2026-09-17T00:00:00Z',
        updated_at: '2026-09-17T00:00:00Z',
        ...overrides,
    }) as RoastProfile;

const listRow = (overrides: Partial<RoastProfile> & Partial<RoastProfileWithSource> = {}): RoastProfileWithSource => ({
    ...profile(overrides),
    source_session: overrides.source_session ?? { tsv_path: 'r2/s1.tsv', events: null },
    default_bean: overrides.default_bean ?? null,
    default_blend: overrides.default_blend ?? null,
});

const qcOptions = { defaultOptions: { queries: { retry: false, staleTime: Infinity } } } as const;

describe('roast profile mutation cache (#471)', () => {
    it('create prepends the new row onto the list used by count/cards', () => {
        const qc = new QueryClient(qcOptions);
        const existing = listRow({ id: 'p1', name: 'Existing' });
        qc.setQueryData(roastProfileKeys.all(uid), [existing]);

        const created = profile({ id: 'p2', name: 'QA Smoke 0917' });
        applyCreatedRoastProfileCache(qc, uid, created);

        const list = qc.getQueryData<RoastProfileWithSource[]>(roastProfileKeys.all(uid));
        expect(list).toHaveLength(2);
        expect(list?.[0]).toMatchObject({ id: 'p2', name: 'QA Smoke 0917' });
        expect(list?.[1]).toMatchObject({ id: 'p1', name: 'Existing' });
        expect(qc.getQueryState(roastProfileKeys.all(uid))?.isInvalidated).toBe(true);
    });

    it('create does not invent a list when the cache is cold', () => {
        const qc = new QueryClient(qcOptions);
        applyCreatedRoastProfileCache(qc, uid, profile({ id: 'p2', name: 'QA Smoke 0917' }));
        expect(qc.getQueryData(roastProfileKeys.all(uid))).toBeUndefined();
    });

    it('update patches list name/level immediately (detail is derived from the list)', () => {
        const qc = new QueryClient(qcOptions);
        const existing = listRow({ id: 'p1', name: 'QA Smoke 0917', target_level: 'Medium' });
        qc.setQueryData(roastProfileKeys.all(uid), [existing]);

        applyUpdatedRoastProfileCache(
            qc,
            uid,
            profile({ id: 'p1', name: 'QA Smoke 0917b', target_level: 'Medium-Light' }),
        );

        const list = qc.getQueryData<RoastProfileWithSource[]>(roastProfileKeys.all(uid));
        expect(list?.[0]).toMatchObject({
            id: 'p1',
            name: 'QA Smoke 0917b',
            target_level: 'Medium-Light',
            source_session: existing.source_session,
        });
        expect(qc.getQueryState(roastProfileKeys.all(uid))?.isInvalidated).toBe(true);
    });
});

describe('roast profile mutation hooks (#471)', () => {
    const mountMutation = <T>(useHook: (userId: string) => T): { api: T; qc: QueryClient; unmount: () => void } => {
        const qc = new QueryClient(qcOptions);
        const host = document.createElement('div');
        const root = createRoot(host);
        let api: T | undefined;
        const Probe = () => {
            api = useHook(uid);
            return null;
        };
        act(() => {
            root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
        });
        if (!api) throw new Error('Hook did not render');
        return {
            api,
            qc,
            unmount: () => {
                act(() => root.unmount());
                qc.clear();
            },
        };
    };

    it('useCreateRoastProfile patches the mounted list on success', async () => {
        const created = profile({ id: 'p2', name: 'QA Smoke 0917' });
        vi.mocked(roastProfileApi.create).mockResolvedValueOnce(created);
        const { api, qc, unmount } = mountMutation(useCreateRoastProfile);
        qc.setQueryData(roastProfileKeys.all(uid), [listRow({ id: 'p1', name: 'Existing' })]);

        await act(async () => {
            await api.mutateAsync(created);
        });

        const list = qc.getQueryData<RoastProfileWithSource[]>(roastProfileKeys.all(uid));
        expect(list?.[0]).toMatchObject({ id: 'p2', name: 'QA Smoke 0917' });
        expect(list).toHaveLength(2);
        unmount();
    });

    it('useUpdateRoastProfile patches list name/level on success', async () => {
        const updated = profile({ id: 'p1', name: 'QA Smoke 0917b', target_level: 'Medium-Light' });
        vi.mocked(roastProfileApi.update).mockResolvedValueOnce(updated);
        const { api, qc, unmount } = mountMutation(useUpdateRoastProfile);
        qc.setQueryData(roastProfileKeys.all(uid), [
            listRow({ id: 'p1', name: 'QA Smoke 0917', target_level: 'Medium' }),
        ]);

        await act(async () => {
            await api.mutateAsync({ id: 'p1', name: 'QA Smoke 0917b', target_level: 'Medium-Light' });
        });

        expect(qc.getQueryData<RoastProfileWithSource[]>(roastProfileKeys.all(uid))?.[0]).toMatchObject({
            name: 'QA Smoke 0917b',
            target_level: 'Medium-Light',
        });
        unmount();
    });
});
