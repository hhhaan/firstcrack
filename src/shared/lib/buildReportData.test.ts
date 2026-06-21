import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { describe, expect, it, vi } from 'vitest';
import { buildReportData } from './buildReportData';

const session = (overrides: Partial<RoastSessionWithRelations> = {}): RoastSessionWithRelations =>
    ({
        id: '1',
        roasted_at: '2025-06-15T10:00:00Z',
        weight_grams: 820,
        beans: { name: 'Ethiopia', origin: 'Ethiopia' },
        roast_profiles: { name: 'City', target_level: 'Medium' },
        ...overrides,
    }) as RoastSessionWithRelations;

describe('buildReportData', () => {
    it('includes only sessions from the current month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-20T12:00:00Z'));

        const result = buildReportData(
            [session({ id: 'current' }), session({ id: 'old', roasted_at: '2025-05-01T10:00:00Z' })],
            'Roaster Kim',
            'user@example.com',
        );

        expect(result.year).toBe(2025);
        expect(result.month).toBe(6);
        expect(result.totalRoasts).toBe(1);
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0].beanLot).toBe('Ethiopia');
        expect(result.sessions[0].worker).toBe('Roaster Kim');
        expect(result.totalOutputKg).toBe(0.82);
        expect(result.totalInputKg).toBe(1);

        vi.useRealTimers();
    });

    it('falls back to email when display name is missing', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-20T12:00:00Z'));

        const result = buildReportData([session()], null, 'fallback@example.com');
        expect(result.sessions[0].worker).toBe('fallback@example.com');

        vi.useRealTimers();
    });
});
