// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useRoastChargeUsage } from './useRoastChargeUsage';

const fetchUsage = vi.hoisted(() => vi.fn());
vi.mock('@shared/lib/profile', () => ({ fetchRoastChargeUsage: fetchUsage }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

it.each(['pro', 'tester', 'trial'])('refreshes %s at a monthly boundary, without renewing a trial', async (plan) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-30T23:59:59Z'));
    const current = {
        plan,
        used_batches: 200,
        reserved_batches: 0,
        batch_cap: 200,
        period_start: '2026-11-01T00:00:00Z',
        period_end: '2026-12-01T00:00:00Z',
        denial_code: 'monthly_batch_cap_exceeded',
    };
    fetchUsage.mockResolvedValueOnce(current).mockResolvedValue({
        ...current,
        used_batches: 0,
        period_start: '2026-12-01T00:00:00Z',
        period_end: '2027-01-01T00:00:00Z',
        denial_code: null,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const root = createRoot(document.createElement('div'));
    let used: number | undefined;
    function Probe() {
        used = useRoastChargeUsage('owner', plan).data?.used_batches;
        return null;
    }
    try {
        await act(async () => {
            root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(used).toBe(200);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1002);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(used).toBe(plan === 'trial' ? 200 : 0);
        expect(fetchUsage).toHaveBeenCalledTimes(plan === 'trial' ? 1 : 2);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(fetchUsage).toHaveBeenCalledTimes(plan === 'trial' ? 1 : 2);
    } finally {
        act(() => root.unmount());
        qc.clear();
    }
});
