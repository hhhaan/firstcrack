import type { Bean } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { replaceOptimisticBean } from './queries';

const USER = 'user-1';
const OPT = 'opt_11111111-1111-4111-8111-111111111111';
const REAL = '11111111-1111-4111-8111-111111111111';

const bean = (id: string, name = 'Yirg'): Bean =>
    ({
        id,
        user_id: USER,
        name,
        capacity_grams: 5000,
        low_stock_threshold_grams: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        altitude_masl: null,
        cost_per_kg: null,
        farm: null,
        origin: null,
        process: null,
        purchase_date: null,
        region: null,
        tasting_notes: null,
        variety: null,
        vendor: null,
    }) satisfies Bean;

describe('replaceOptimisticBean', () => {
    it('swaps the temp row in place', () => {
        const old = bean('other-id', 'Ethiopia');
        const next = replaceOptimisticBean([bean(OPT), old], bean(REAL), OPT);
        expect(next.map((row) => row.id)).toEqual([REAL, 'other-id']);
    });

    it('prepends when the optimistic row was already removed', () => {
        const next = replaceOptimisticBean([], bean(REAL), OPT);
        expect(next.map((row) => row.id)).toEqual([REAL]);
    });
});
