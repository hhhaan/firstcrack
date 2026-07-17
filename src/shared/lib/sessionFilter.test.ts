import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { filterSessions, paginateSessions, sortSessions } from './sessionFilter';

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

describe('sortSessions', () => {
    it('sorts beans alphabetically', () => {
        const sessions = [
            session({ id: 'a', beans: bean('Zambia', 'Zambia') }),
            session({ id: 'b', beans: bean('Apple', 'Kenya') }),
        ];
        expect(sortSessions(sessions, 'bean', true).map((s) => s.id)).toEqual(['b', 'a']);
    });
});

describe('paginateSessions', () => {
    it('returns the requested page slice', () => {
        expect(paginateSessions([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    });
});
