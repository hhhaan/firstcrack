// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { useTrialEventAdmission } from './useTrialEventAdmission';

const mocks = vi.hoisted(() => ({
    owner: 'owner-a',
    plan: 'trial-event',
    endsAt: '2099-01-01T00:00:00Z',
    reserve: vi.fn(),
    release: vi.fn(),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: mocks.owner, isWorkspaceReady: true }),
}));
vi.mock('@shared/lib/features', async (original) => ({
    ...(await original<typeof import('@shared/lib/features')>()),
    useEffectivePlan: () => mocks.plan,
    useTrialEventGrant: () => ({ data: { ends_at: mocks.endsAt } }),
}));
vi.mock('@entities/trial-event', () => ({ trialEventApi: { reserve: mocks.reserve, release: mocks.release } }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanup: Array<() => void> = [];
function mount() {
    const root = createRoot(document.createElement('div'));
    const qc = new QueryClient();
    let value: ReturnType<typeof useTrialEventAdmission>;
    function Probe() {
        value = useTrialEventAdmission();
        return null;
    }
    const render = () =>
        act(() => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe))));
    render();
    cleanup.push(() => {
        act(() => root.unmount());
        qc.clear();
    });
    return {
        get value() {
            return value;
        },
        render,
    };
}
beforeEach(() => {
    mocks.owner = 'owner-a';
    mocks.plan = 'trial-event';
    mocks.endsAt = '2099-01-01T00:00:00Z';
    vi.clearAllMocks();
    mocks.reserve.mockResolvedValue(undefined);
    mocks.release.mockResolvedValue(undefined);
    useRoastingStore.getState().reset();
    useRoastingStore.setState({ phase: 'preheating' });
});
afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
});

describe('trial batch preflight', () => {
    it('returns an unused preparation when the deadline passes while the app stays open', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
        mocks.endsAt = '2026-11-04T00:00:01Z';
        try {
            const h = mount();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1);
            });
            expect(h.value?.ready).toBe(true);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1001);
            });
            expect(h.value?.ready).toBe(false);
            expect(h.value?.take()).toBeNull();
            expect(mocks.release).toHaveBeenCalledWith('owner-a', mocks.reserve.mock.calls[0][1]);
        } finally {
            vi.useRealTimers();
        }
    });
    it('does not admit a new batch after the grant expires', async () => {
        mocks.endsAt = '2020-01-01T00:00:00Z';
        const h = mount();
        await act(async () => {
            await Promise.resolve();
        });
        expect(h.value?.ready).toBe(false);
        expect(h.value?.take()).toBeNull();
        expect(mocks.reserve).not.toHaveBeenCalled();
    });
    it('prepares once across preheat/standby and consumes synchronously at Charge', async () => {
        const h = mount();
        await act(async () => {
            await vi.waitFor(() => expect(mocks.reserve).toHaveBeenCalledTimes(1));
        });
        expect(h.value?.ready).toBe(true);
        act(() => useRoastingStore.setState({ phase: 'standby' }));
        expect(mocks.reserve).toHaveBeenCalledTimes(1);
        const id = mocks.reserve.mock.calls[0][1];
        act(() => {
            expect(h.value?.take()).toBe(id);
            useRoastingStore.getState().startCharge(undefined, mocks.owner, { bt: 190, unit: 'C', sessionId: id });
        });
        expect(mocks.release).not.toHaveBeenCalled();
        expect(h.value?.ready).toBe(false);
        await act(async () => {
            useRoastingStore.setState({ phase: 'standby', sessionId: null });
        });
        expect(mocks.reserve).toHaveBeenCalledTimes(2);
        expect(mocks.reserve.mock.calls[1][1]).not.toBe(id);
    });
    it('returns an unused slot when leaving preheat', async () => {
        const h = mount();
        await act(async () => {
            await vi.waitFor(() => expect(mocks.reserve).toHaveBeenCalledTimes(1));
        });
        await act(async () => useRoastingStore.setState({ phase: 'idle' }));
        expect(h.value?.ready).toBe(false);
        expect(mocks.release).toHaveBeenCalledWith('owner-a', mocks.reserve.mock.calls[0][1]);
    });
    it('never applies a late reservation to a different workspace', async () => {
        let approve!: () => void;
        mocks.reserve.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    approve = resolve;
                }),
        );
        const h = mount();
        await act(async () => {
            await vi.waitFor(() => expect(mocks.reserve).toHaveBeenCalledTimes(1));
        });
        mocks.owner = 'owner-b';
        await act(async () => h.render());
        await act(async () => approve());
        expect(mocks.release).toHaveBeenCalledWith('owner-a', mocks.reserve.mock.calls[0][1]);
        expect(h.value?.ready).toBe(true);
        act(() => expect(h.value?.take()).toBe(mocks.reserve.mock.calls[1][1]));
    });
    it('does not reserve for existing tester accounts', async () => {
        mocks.plan = 'tester';
        const h = mount();
        await act(async () => {
            await Promise.resolve();
        });
        expect(h.value).toBeUndefined();
        expect(mocks.reserve).not.toHaveBeenCalled();
    });
});
