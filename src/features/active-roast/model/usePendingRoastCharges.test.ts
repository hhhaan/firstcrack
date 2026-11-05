// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeRoastCharge, enqueueRoastCharge, listPendingRoastCharges } from './pendingRoastCharges';
import { usePendingRoastCharges } from './usePendingRoastCharges';

const mocks = vi.hoisted(() => ({ record: vi.fn(), capture: vi.fn() }));
vi.mock('@entities/roast-charge', () => ({ roastChargeApi: { record: mocks.record } }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: mocks.capture } }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanup: Array<() => void> = [];
const first = { owner: 'owner-a', id: 'charge-a', chargedAt: '2026-11-05T01:00:00Z' };
function mount(owner = 'owner-a', ready = true) {
    const root = createRoot(document.createElement('div'));
    const qc = new QueryClient();
    function Probe(props: { owner: string; ready: boolean }) {
        usePendingRoastCharges(props.owner, props.ready);
        return null;
    }
    const render = (nextOwner = owner, nextReady = ready) =>
        act(() =>
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: qc },
                    createElement(Probe, { owner: nextOwner, ready: nextReady }),
                ),
            ),
        );
    render();
    const unmount = () => {
        act(() => root.unmount());
        qc.clear();
    };
    cleanup.push(unmount);
    return { render, unmount };
}
beforeEach(() => {
    for (const item of listPendingRoastCharges()) acknowledgeRoastCharge(item);
    localStorage.clear();
    vi.clearAllMocks();
    mocks.record.mockResolvedValue(undefined);
});
afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
    vi.restoreAllMocks();
});

describe('Charge outbox', () => {
    it('recovers durable usage on launch and only submits the ready workspace owner', async () => {
        localStorage.setItem(
            'fc_pending_roast_charges_v1',
            JSON.stringify([first, { ...first, owner: 'owner-b', id: 'charge-b' }]),
        );
        const h = mount('owner-a', false);
        await act(async () => {});
        expect(mocks.record).not.toHaveBeenCalled();
        await act(async () => h.render('owner-a', true));
        expect(mocks.record).toHaveBeenCalledExactlyOnceWith(first.owner, first.id, first.chargedAt);
        expect(listPendingRoastCharges()).toEqual([expect.objectContaining({ owner: 'owner-b' })]);
        await act(async () => h.render('owner-b', true));
        expect(listPendingRoastCharges()).toEqual([]);
    });
    it('preserves the first Charge time when the event is submitted twice', async () => {
        enqueueRoastCharge(first);
        enqueueRoastCharge({ ...first, chargedAt: '2026-11-06T01:00:00Z' });
        mount();
        await act(async () => {});
        expect(mocks.record).toHaveBeenCalledExactlyOnceWith(first.owner, first.id, first.chargedAt);
        expect(listPendingRoastCharges()).toEqual([]);
    });
    it('retains a refused acknowledgement and retries the same UUID on reconnect', async () => {
        mocks.record.mockRejectedValueOnce({ code: '42501', message: 'temporarily denied' });
        enqueueRoastCharge(first);
        mount();
        await act(async () => {});
        expect(listPendingRoastCharges()).toEqual([first]);
        await act(async () => window.dispatchEvent(new Event('online')));
        expect(mocks.record).toHaveBeenCalledTimes(2);
        expect(mocks.record.mock.calls[1]).toEqual(mocks.record.mock.calls[0]);
        expect(listPendingRoastCharges()).toEqual([]);
    });
    it('drains a new Charge enqueued while an earlier acknowledgement is pending', async () => {
        let acknowledge!: () => void;
        mocks.record.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    acknowledge = resolve;
                }),
        );
        mount();
        await act(async () => enqueueRoastCharge(first));
        await act(async () => enqueueRoastCharge({ ...first, id: 'charge-next' }));
        expect(listPendingRoastCharges()).toHaveLength(2);
        await act(async () => acknowledge());
        expect(mocks.record).toHaveBeenCalledTimes(2);
        expect(listPendingRoastCharges()).toEqual([]);
    });
    it('does not interrupt Charge when local storage fails, and still sends the in-memory entry', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('disk full');
        });
        mount();
        await act(async () => {
            expect(() => enqueueRoastCharge(first)).not.toThrow();
        });
        expect(mocks.capture).toHaveBeenCalled();
        expect(mocks.record).toHaveBeenCalledExactlyOnceWith(first.owner, first.id, first.chargedAt);
        expect(listPendingRoastCharges()).toEqual([]);
    });
});
