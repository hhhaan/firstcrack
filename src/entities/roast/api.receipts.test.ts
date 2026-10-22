import type { Json } from '@shared/types/database.types';
import type { StoredRoastEvent } from '@shared/types/roast';
import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@shared/lib/supabase', () => ({ supabase: { from: db.from } }));

import { roastSessionApi } from './api';

const receipt: StoredRoastEvent = {
    id: 'control:session:charge:1',
    type: 'Control',
    time_sec: 22,
    control_receipt: { kind: 'unavailable', session_id: 'session', charge_id: 'charge', after: 1 },
};
let events: Json;
let conflict: boolean;
let writes: Json[];
beforeEach(() => {
    events = [{ id: 'mark', type: 'FC Start', time_sec: 20 }];
    conflict = false;
    writes = [];
    db.from.mockImplementation(() => {
        let payload: { events: Json } | undefined;
        let expected: string | null | undefined;
        const filters = new Map<string, unknown>();
        const chain = {
            select: (_columns: string) => {
                if (!payload) return chain;
                expect(filters.get('id')).toBe('session');
                expect(filters.get('user_id')).toBe('owner');
                if (conflict) {
                    conflict = false;
                    events = [{ id: 'mark', type: 'FC Start', time_sec: 25 }];
                }
                if ((expected === null && events === null) || expected === JSON.stringify(events)) {
                    events = payload.events;
                    writes.push(events);
                    return Promise.resolve({ data: [{ id: 'session' }], error: null });
                }
                return Promise.resolve({ data: [], error: null });
            },
            eq: (key: string, value: unknown) => {
                if (key === 'events' && typeof value === 'string') expected = value;
                else filters.set(key, value);
                return chain;
            },
            is: (_key: string, value: null) => {
                expected = value;
                return chain;
            },
            update: (value: { events: Json }) => {
                payload = value;
                return chain;
            },
            single: () => Promise.resolve({ data: { events: structuredClone(events) }, error: null }),
        };
        return chain;
    });
});
it('rereads on a concurrent History edit and appends once without reverting its mark', async () => {
    conflict = true;
    expect(await roastSessionApi.appendControlReceipts('owner', 'session', [receipt])).toBe(true);
    expect(events).toEqual([{ id: 'mark', type: 'FC Start', time_sec: 25 }, receipt]);
    expect(await roastSessionApi.appendControlReceipts('owner', 'session', [receipt])).toBe(false);
    expect(writes).toHaveLength(1);
});
it('supports a null event column and rejects non-receipt writes', async () => {
    events = null;
    await roastSessionApi.appendControlReceipts('owner', 'session', [receipt]);
    expect(events).toEqual([receipt]);
    await expect(
        roastSessionApi.appendControlReceipts('owner', 'session', [{ id: 'bad', type: 'Drop', time_sec: 20 }]),
    ).rejects.toThrow();
});
