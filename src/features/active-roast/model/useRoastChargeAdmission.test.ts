// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { useRoastChargeAdmission } from './useRoastChargeAdmission';

const mocks = vi.hoisted(() => ({
    owner: 'owner-a',
    ready: true,
    plan: 'trial-event',
    endsAt: '2099-01-01T00:00:00Z',
    used: 0,
    reserved: 0,
    reserve: vi.fn(),
    enqueue: vi.fn(),
    release: vi.fn(),
}));
vi.mock('./pendingRoastCharges', () => ({ enqueueRoastCharge: mocks.enqueue }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: mocks.owner, isWorkspaceReady: mocks.ready }),
}));
vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@shared/lib/features', async (original) => ({
    ...(await original<typeof import('@shared/lib/features')>()),
    useEffectivePlan: () => mocks.plan,
    useRoastChargeUsage: () => ({
        data: { period_end: mocks.endsAt, batch_cap: 100, used_batches: mocks.used, reserved_batches: mocks.reserved },
    }),
}));
vi.mock('@entities/roast-charge', () => ({
    roastChargeApi: { reserve: mocks.reserve, release: mocks.release },
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanup: Array<() => void> = [];
function mount() {
    const root = createRoot(document.createElement('div'));
    const qc = new QueryClient();
    let value: ReturnType<typeof useRoastChargeAdmission>;
    function Probe() {
        value = useRoastChargeAdmission();
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
    mocks.ready = true;
    mocks.plan = 'trial-event';
    mocks.endsAt = '2099-01-01T00:00:00Z';
    mocks.used = 0;
    mocks.reserved = 0;
    vi.clearAllMocks();
    mocks.reserve.mockResolvedValue(undefined);
    mocks.enqueue.mockResolvedValue(undefined);
    mocks.release.mockResolvedValue(undefined);
    useRoastingStore.getState().reset();
    useRoastingStore.setState({ phase: 'preheating' });
});
afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
    vi.useRealTimers();
});

describe('trial batch preflight', () => {
    it.each(['online', 'timer'])('recovers an exhausted reservation on %s with the same UUID', async (trigger) => {
        vi.useFakeTimers();
        mocks.reserve.mockRejectedValue(trigger === 'online' ? new TypeError('Failed to fetch') : { status: 503 });
        const h = mount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3100);
        });
        expect(h.value.ready).toBe(false);
        const id = mocks.reserve.mock.calls[0][1];
        mocks.reserve.mockResolvedValue(undefined);
        await act(async () => {
            if (trigger === 'online') {
                window.dispatchEvent(new Event('online'));
                window.dispatchEvent(new Event('online'));
            } else await vi.advanceTimersByTimeAsync(5000);
        });
        expect(h.value.ready).toBe(true);
        expect(mocks.reserve.mock.calls.every((call) => call[1] === id)).toBe(true);
        expect(mocks.release).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(mocks.reserve).toHaveBeenCalledTimes(4);
    });
    it('stops retrying and releases an uncertain reservation when leaving Charge wait', async () => {
        vi.useFakeTimers();
        mocks.reserve.mockRejectedValue(new TypeError('Failed to fetch'));
        const h = mount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3100);
        });
        const id = mocks.reserve.mock.calls[0][1];
        await act(async () => {
            useRoastingStore.setState({ phase: 'idle' });
        });
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(h.value.ready).toBe(false);
        expect(mocks.reserve).toHaveBeenCalledTimes(3);
        expect(mocks.release).toHaveBeenCalledWith('owner-a', id);
    });
    it('does not retry an authorization refusal on reconnect or a timer', async () => {
        vi.useFakeTimers();
        mocks.reserve.mockRejectedValue({ status: 403 });
        const h = mount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3100);
        });
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(h.value.ready).toBe(false);
        expect(mocks.reserve).toHaveBeenCalledTimes(1);
    });
    it('does not Charge for an unresolved workspace even on an unlimited plan', async () => {
        mocks.plan = 'tester';
        mocks.ready = false;
        const h = mount();
        await act(async () => {});
        expect(h.value?.ready).toBe(false);
        expect(h.value?.take()).toBeNull();
        expect(mocks.reserve).not.toHaveBeenCalled();
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it.each(['trial', 'pro'])('replaces the preparation when the %s billing period changes', async (plan) => {
        mocks.plan = plan;
        const h = mount();
        await act(async () => {});
        const oldId = mocks.reserve.mock.calls[0][1];
        mocks.endsAt = '2100-01-01T00:00:00Z';
        await act(async () => h.render());
        expect(mocks.release).toHaveBeenCalledExactlyOnceWith('owner-a', oldId);
        expect(mocks.reserve).toHaveBeenCalledTimes(2);
        expect(h.value?.ready).toBe(true);
        act(() => expect(h.value?.take()).toBe(mocks.reserve.mock.calls[1][1]));
    });
    it('keeps the same Charge after Cancel Drop and only returns the unused next preparation', async () => {
        const h = mount();
        await act(async () => {});
        const id = mocks.reserve.mock.calls[0][1];
        await act(async () => {
            expect(h.value?.take()).toBe(id);
            h.value?.confirm(id, Date.now());
            useRoastingStore
                .getState()
                .startCharge(Date.now() - 60_000, mocks.owner, { bt: 190, unit: 'C', sessionId: id });
        });
        await act(async () => {
            useRoastingStore.setState({ sidecarConnected: true, elapsed: 60 });
            useRoastingStore.getState().drop({ rawBT: 200, unit: 'C', replayActive: false });
        });
        expect(mocks.reserve).toHaveBeenCalledTimes(2);
        const nextId = mocks.reserve.mock.calls[1][1];
        await act(async () => {
            expect(useRoastingStore.getState().cancelDrop(id)).not.toBeNull();
        });
        expect(useRoastingStore.getState().sessionId).toBe(id);
        expect(useRoastingStore.getState().phase).toBe('roasting');
        expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ owner: 'owner-a', id }));
        expect(mocks.release).toHaveBeenCalledExactlyOnceWith('owner-a', nextId);
    });
    it('retries when capacity returns before an earlier refusal arrives', async () => {
        mocks.used = 99;
        mocks.reserved = 1;
        let refuse!: (error: Error) => void;
        mocks.reserve.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    refuse = reject;
                }),
        );
        const h = mount();
        await act(async () => {});
        mocks.reserved = 0;
        await act(async () => h.render());
        await act(async () => refuse(new Error('trial_event_batch_cap')));
        expect(mocks.reserve).toHaveBeenCalledTimes(2);
        expect(h.value?.ready).toBe(true);
    });
    it('commits Charge once without waiting for acknowledgement or refunding on teardown', async () => {
        mocks.enqueue.mockImplementationOnce(() => new Promise<void>(() => {}));
        const h = mount();
        await act(async () => {});
        const id = mocks.reserve.mock.calls[0][1];
        await act(async () => {
            expect(h.value?.take()).toBe(id);
            h.value?.confirm(id, Date.now());
            expect(h.value?.take()).toBeNull();
            useRoastingStore.setState({ phase: 'roasting' });
        });
        expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ owner: 'owner-a', id }));
        expect(mocks.release).not.toHaveBeenCalled();
    });
    it('retries after unused capacity returns without cycling its own prepared slot', async () => {
        mocks.used = 99;
        mocks.reserved = 1;
        mocks.reserve.mockRejectedValueOnce(new Error('trial_event_batch_cap'));
        const h = mount();
        await act(async () => {});
        expect(h.value?.ready).toBe(false);
        expect(mocks.reserve).toHaveBeenCalledTimes(1);
        await act(async () => h.render());
        expect(mocks.reserve).toHaveBeenCalledTimes(1);
        mocks.reserved = 0;
        await act(async () => h.render());
        expect(mocks.reserve).toHaveBeenCalledTimes(2);
        expect(h.value?.ready).toBe(true);
        mocks.reserved = 1;
        await act(async () => h.render());
        expect(h.value?.ready).toBe(true);
        expect(mocks.reserve).toHaveBeenCalledTimes(2);
        // Only cleanup of the refused attempt, never the usable final slot.
        expect(mocks.release).toHaveBeenCalledTimes(1);
    });
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
            h.value?.confirm(id, Date.now());
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
        expect(h.value?.ready).toBe(true);
        act(() => {
            const id = h.value?.take();
            expect(id).toBeTruthy();
            if (id) h.value?.confirm(id, Date.now());
        });
        expect(mocks.enqueue).toHaveBeenCalledTimes(1);
        expect(mocks.reserve).not.toHaveBeenCalled();
    });
});
