import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { filterSessions, filterSessionsByDateRange, paginateSessions, sortSessions, ymInRange } from './sessionFilter';

const bean = (name: string, origin: string): NonNullable<RoastSessionWithRelations['beans']> => ({
    name,
    origin,
    region: null,
    variety: null,
    process: null,
    farm: null,
});

const session = (overrides: Partial<RoastSessionWithRelations> = {}): RoastSessionWithRelations =>
    ({
        id: '1',
        roasted_at: '2025-06-15T10:00:00Z',
        roast_level: 'Medium',
        duration_seconds: 600,
        drop_temp_celsius: 210,
        weight_grams: 1000,
        beans: bean('Ethiopia Yirgacheffe', 'Ethiopia'),
        roast_profiles: { name: 'Light City', target_level: 'Medium' },
        ...overrides,
    }) as RoastSessionWithRelations;

describe('filterSessions', () => {
    it('searches independent batch titles as well as bean names', () => {
        const records = [session({ batch_name: 'Batch C', bean_label: null })];
        expect(
            filterSessions(records, {
                search: 'Batch C',
                levelFilter: 'all',
                originFilter: 'all',
                fromYM: '',
                toYM: '',
            }),
        ).toHaveLength(1);
    });

    const sessions = [
        session({ id: '1', beans: bean('Ethiopia', 'Ethiopia'), roast_level: 'Light' }),
        session({ id: '2', beans: bean('Colombia', 'Colombia'), roast_level: 'Dark' }),
        session({
            id: '3',
            roasted_at: '2024-01-10T10:00:00Z',
            beans: bean('Brazil', 'Brazil'),
            roast_profiles: { name: 'Espresso', target_level: 'Dark' },
        }),
    ];

    it('returns all sessions when no filters active', () => {
        expect(
            filterSessions(sessions, {
                search: '',
                levelFilter: 'all',
                fromYM: '',
                toYM: '',
                originFilter: 'all',
            }),
        ).toHaveLength(3);
    });

    it('filters by search across bean, profile, and origin', () => {
        expect(
            filterSessions(sessions, {
                search: 'espresso',
                levelFilter: 'all',
                fromYM: '',
                toYM: '',
                originFilter: 'all',
            }),
        ).toEqual([sessions[2]]);
    });

    it('filters by level and origin', () => {
        expect(
            filterSessions(sessions, {
                search: '',
                levelFilter: 'Dark',
                fromYM: '',
                toYM: '',
                originFilter: 'Colombia',
            }),
        ).toEqual([sessions[1]]);
    });

    it('filters by year-month range', () => {
        expect(
            filterSessions(sessions, {
                search: '',
                levelFilter: 'all',
                fromYM: '2025-06',
                toYM: '2025-06',
                originFilter: 'all',
            }),
        ).toEqual([sessions[0], sessions[1]]);
    });
});

describe('ymInRange', () => {
    it('treats empty bounds as unbounded', () => {
        expect(ymInRange('2025-06-15T00:00:00Z', '', '')).toBe(true);
        expect(ymInRange(null, '', '')).toBe(true);
    });

    it('rejects null roasted_at when bounds set', () => {
        expect(ymInRange(null, '2025-01', '2025-12')).toBe(false);
    });
});

describe('filterSessionsByDateRange', () => {
    it('ignores level/origin and keeps date-only slice', () => {
        const sessions = [
            session({ id: '1', roasted_at: '2025-06-15T10:00:00Z', roast_level: 'Light' }),
            session({ id: '2', roasted_at: '2025-06-20T10:00:00Z', roast_level: 'Dark' }),
            session({ id: '3', roasted_at: '2024-01-10T10:00:00Z', roast_level: 'Light' }),
        ];
        expect(filterSessionsByDateRange(sessions, '2025-06', '2025-06').map((s) => s.id)).toEqual(['1', '2']);
    });
});

describe('sortSessions', () => {
    it('sorts beans alphabetically', () => {
        const sessions = [
            session({ id: 'a', beans: bean('Zambia', 'Zambia') }),
            session({ id: 'b', beans: bean('Apple', 'Kenya') }),
        ];
        expect(sortSessions(sessions, 'bean', true).map((s) => s.id)).toEqual(['b', 'a']);
    });

    it('sorts the green bean column without interpreting an unlinked roast title as a bean', () => {
        const sessions = [
            session({ id: 'unlinked', beans: null, bean_label: 'ZZZ batch' }),
            session({ id: 'linked', beans: bean('Zambia', 'Zambia'), bean_label: 'ZZZ batch' }),
        ];
        expect(sortSessions(sessions, 'bean', true).map((s) => s.id)).toEqual(['unlinked', 'linked']);
    });

    it('sorts duration by Drop-first roast duration, not record End', () => {
        const sessions = [
            session({
                id: 'late-drop',
                duration_seconds: 500,
                events: [
                    { id: 'd', type: 'Drop', time_sec: 700 },
                    { id: 'e', type: 'End', time_sec: 500 },
                ],
            }),
            session({
                id: 'early-drop',
                duration_seconds: 900,
                events: [
                    { id: 'd', type: 'Drop', time_sec: 400 },
                    { id: 'e', type: 'End', time_sec: 900 },
                ],
            }),
        ];
        expect(sortSessions(sessions, 'duration', true).map((s) => s.id)).toEqual(['early-drop', 'late-drop']);
    });

    it('includes oldest shortest/longest sessions past the 1000-row PostgREST cap in sort and page count', () => {
        const pageSize = 10;
        const sessions = Array.from({ length: 1001 }, (_, i) =>
            session({
                id: `s${i}`,
                duration_seconds: 800,
                events: [{ id: 'd', type: 'Drop', time_sec: 500 }],
            }),
        );
        sessions[1000] = session({
            id: 'oldest-shortest',
            duration_seconds: 900,
            events: [{ id: 'd', type: 'Drop', time_sec: 100 }],
        });
        sessions[999] = session({
            id: 'oldest-longest',
            duration_seconds: 400,
            events: [{ id: 'd', type: 'Drop', time_sec: 900 }],
        });

        const asc = sortSessions(sessions, 'duration', true);
        expect(asc).toHaveLength(1001);
        expect(asc[0].id).toBe('oldest-shortest');
        expect(Math.ceil(asc.length / pageSize)).toBe(101);
        expect(paginateSessions(asc, 1, pageSize)[0].id).toBe('oldest-shortest');

        const desc = sortSessions(sessions, 'duration', false);
        expect(desc[0].id).toBe('oldest-longest');
        expect(paginateSessions(desc, 101, pageSize).some((s) => s.id === 'oldest-shortest')).toBe(true);
    });
});

describe('paginateSessions', () => {
    it('returns the requested page slice', () => {
        expect(paginateSessions([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    });
});
