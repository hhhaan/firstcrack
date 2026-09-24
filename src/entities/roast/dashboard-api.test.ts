/**
 * Drives shipped roastSessionApi dashboard methods (CQ-R6 path).
 * Asserts API surface used by widgets/dashboard-summary — no raw supabase in the widget.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => fromMock(...args),
    },
}));

// Import after mock
const { roastSessionApi } = await import('./api');

function mockSelectChain(data: unknown[] = []) {
    const terminal = Promise.resolve({ data, error: null });
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const k of ['select', 'eq', 'gte', 'order', 'lt', 'lte', 'range', 'single']) {
        chain[k] = vi.fn(self);
    }
    // Return a real Promise so await works without a custom thenable property name
    Object.assign(chain, {
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for supabase builder
        then: terminal.then.bind(terminal),
        catch: terminal.catch.bind(terminal),
    });
    fromMock.mockReturnValue(chain);
}

describe('roastSessionApi dashboard reads', () => {
    beforeEach(() => {
        fromMock.mockReset();
        mockSelectChain([]);
    });

    it('exposes listCompletedDashboard used by dashboard widget compose', async () => {
        expect(typeof roastSessionApi.listCompletedDashboard).toBe('function');
        const rows = await roastSessionApi.listCompletedDashboard('user-1', '2026-01-01T00:00:00.000Z');
        expect(Array.isArray(rows)).toBe(true);
        expect(fromMock).toHaveBeenCalledWith('roast_sessions');
        const chain = fromMock.mock.results[0]?.value as { select: { mock: { calls: unknown[][] } } };
        expect(String(chain.select.mock.calls[0]?.[0])).toContain('events');
    });

    it('exposes listCompletedWeightsSince for monthly chart series', async () => {
        expect(typeof roastSessionApi.listCompletedWeightsSince).toBe('function');
        const rows = await roastSessionApi.listCompletedWeightsSince('user-1', '2025-07-01T00:00:00.000Z');
        expect(Array.isArray(rows)).toBe(true);
        expect(fromMock).toHaveBeenCalledWith('roast_sessions');
    });
});
