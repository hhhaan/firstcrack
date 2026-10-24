import { invalidateAfterRoastRecordEdit } from '@entities/roast/queries';
import type { RoastProfile } from '@shared/types/database.types';
import { QueryCache, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { RoastProfileWithSource } from './api';
import { applyCreatedRoastProfileCache, applyUpdatedRoastProfileCache, roastProfileKeys } from './queries';

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
        fc_time_sec: 500,
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

const listRow = (overrides: Partial<RoastProfileWithSource> = {}): RoastProfileWithSource => ({
    ...profile(overrides),
    source_session: {
        tsv_path: 'r2/s1.tsv',
        events: null,
        machine_id: null,
        machine_name: null,
        machine_roaster_key: null,
        machine_protocol: null,
    },
    default_bean: null,
    default_blend: null,
    ...overrides,
});

describe('roast profile mutation cache (#471)', () => {
    it('create prepends the new row onto the list used by count/cards', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
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

    it('update patches list name/level immediately (detail is derived from the list)', () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
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

    it('profile update + history record edit does not refetch an orphan detail cache (FC-27)', async () => {
        const missingQueryFnErrors: string[] = [];
        const qc = new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: Infinity } },
            queryCache: new QueryCache({
                onError: (error) => {
                    if (String(error).includes('Missing queryFn')) {
                        missingQueryFnErrors.push(String(error));
                    }
                },
            }),
        });
        const rows = [listRow({ id: 'p1' })];
        await qc.fetchQuery({
            queryKey: roastProfileKeys.all(uid),
            queryFn: async () => rows,
            staleTime: Infinity,
        });

        applyUpdatedRoastProfileCache(qc, uid, profile({ id: 'p1', name: 'Renamed' }));

        await invalidateAfterRoastRecordEdit(qc, uid);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(missingQueryFnErrors).toEqual([]);
    });
});
