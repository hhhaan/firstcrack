// @vitest-environment jsdom

import type { Charge, CommandReceipt, ReceiptPage } from '@shared/types/sidecar';
import { beforeEach, expect, it, vi } from 'vitest';
import { unresolvedReceiptAttempts } from '../lib/control-receipts';
import {
    parseStoredRoastEvents,
    serializeRoastEvents,
    storedEventsToControlChanges,
} from '../lib/serialize-roast-events';
import {
    drainControlReceipts,
    markReceiptSessionSaved,
    receiptLogsForSave,
    registerReceiptCollection,
    restoreReceiptCollections,
    syncSavedControlReceipts,
    useControlReceiptStore,
} from './controlReceiptCollector';
import { useRoastingStore } from './status';

const mocks = vi.hoisted(() => ({ get: vi.fn(), append: vi.fn() }));
vi.mock('@shared/lib/sidecar', () => ({ sidecar: { getPidReceipts: mocks.get } }));
vi.mock('@entities/roast', () => ({ roastSessionApi: { appendControlReceipts: mocks.append } }));
const charge: Charge = {
    session_id: 'session-a',
    charge_id: 'charge-a',
    sensor_clock: 'boot:1',
    connection_epoch: 1,
    acquired_at: 100,
    accepted_at: 100,
    anchor: null,
    origin_kind: 'now',
    state: 'open',
    closed_reason: null,
    machine: { machine_id: 'virtual', roaster_key: 'virtual', protocol: 'virtual' },
};
const receipt = (
    sequence: number,
    event: CommandReceipt['event'],
    outcome: CommandReceipt['outcome'],
): CommandReceipt => ({
    session_id: charge.session_id,
    charge_id: charge.charge_id,
    sensor_clock: charge.sensor_clock,
    connection_epoch: 1,
    sequence,
    attempt_sequence: 1,
    run_id: 'run',
    generation: 1,
    origin: 'pid',
    purpose: 'terminal',
    event,
    outcome,
    observed_at: 121,
    elapsed_sec: 21,
    sample: null,
    raw_bt_c: 120,
    control_pv_c: 119,
    target_bt_c: 121,
    requested_heat_set: 0,
    permitted_heat_set: 0,
    acknowledged_heat_set: event === 'transmitted' ? 0 : null,
    evidence: event === 'transmitted' ? 'virtual_applied' : 'none',
    reconciles_sequence: event === 'reconciliation' ? 3 : null,
    reason: null,
});
const page = (receipts: CommandReceipt[], extra: Partial<ReceiptPage> = {}): ReceiptPage => ({
    session_id: charge.session_id,
    charge_id: charge.charge_id,
    first_available: 1,
    next_sequence: (receipts[receipts.length - 1]?.sequence ?? 0) + 1,
    next_after: receipts[receipts.length - 1]?.sequence ?? 0,
    has_more: false,
    gap: null,
    receipts,
    ...extra,
});
beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useControlReceiptStore.setState({ collections: {} });
    useRoastingStore.getState().reset();
    registerReceiptCollection(charge, 'owner');
});
it('deduplicates pages and preserves uncertain then late reconciliation as immutable evidence after Drop', async () => {
    const rows = [
        receipt(1, 'attempt', 'pending'),
        receipt(2, 'transmitted', 'succeeded'),
        receipt(3, 'uncertain', 'uncertain'),
    ];
    mocks.get.mockResolvedValue(page(rows));
    await drainControlReceipts(charge.session_id);
    await drainControlReceipts(charge.session_id);
    const first = receiptLogsForSave(charge.session_id, []);
    expect(first).toHaveLength(3);
    expect(unresolvedReceiptAttempts(first)).toBe(1);
    markReceiptSessionSaved(charge.session_id);
    mocks.get.mockResolvedValue(page([receipt(4, 'reconciliation', 'succeeded')], { next_sequence: 5 }));
    await drainControlReceipts(charge.session_id);
    const events = serializeRoastEvents(receiptLogsForSave(charge.session_id, []));
    expect(events.map((entry) => entry.time_sec)).toEqual([21, 21, 21, 21]);
    expect(parseStoredRoastEvents(events)).toEqual(events);
    expect(storedEventsToControlChanges(events)).toEqual([{ timeSec: 21, values: { heater: 0 } }]);
    expect(events[2].control_receipt).toMatchObject({ receipt: { event: 'uncertain', outcome: 'uncertain' } });
    expect(unresolvedReceiptAttempts(receiptLogsForSave(charge.session_id, []))).toBe(0);
    mocks.append.mockResolvedValue(true);
    expect(await syncSavedControlReceipts(charge.session_id)).toBe(true);
    expect(await syncSavedControlReceipts(charge.session_id)).toBe(false);
    expect(mocks.append).toHaveBeenCalledTimes(1);
});
it('records gaps and unavailable without attaching a late prior reply to the new roast', async () => {
    useRoastingStore.setState({ sessionId: 'session-b', logState: { entries: [], unwind: false } });
    mocks.get.mockResolvedValue(
        page([receipt(3, 'uncertain', 'uncertain')], { gap: { from: 1, through: 2 }, first_available: 3 }),
    );
    await drainControlReceipts(charge.session_id);
    expect(receiptLogsForSave(charge.session_id, [])[0].controlReceipt).toMatchObject({
        kind: 'gap',
        from: 1,
        through: 2,
    });
    mocks.get.mockResolvedValue({ ...page([receipt(4, 'reconciliation', 'succeeded')]), session_id: 'wrong' });
    await drainControlReceipts(charge.session_id);
    expect(useControlReceiptStore.getState().collections[charge.session_id].unavailable).toBe(true);
    expect(useRoastingStore.getState().logState.entries).toEqual([]);
    expect(receiptLogsForSave(charge.session_id, [])).toHaveLength(3);
});
it('drains the known cursor through pages before returning', async () => {
    mocks.get
        .mockResolvedValueOnce(page([receipt(1, 'attempt', 'pending')], { next_sequence: 4, has_more: true }))
        .mockResolvedValueOnce(
            page([receipt(2, 'transmitted', 'succeeded'), receipt(3, 'completed', 'succeeded')], { next_sequence: 4 }),
        );
    await drainControlReceipts(charge.session_id);
    expect(mocks.get.mock.calls).toEqual([
        ['charge-a', 0],
        ['charge-a', 1],
    ]);
    expect(receiptLogsForSave(charge.session_id, [])).toHaveLength(3);
});

it('restores known unsynced saved receipts after process state loss and retries without saving stock', async () => {
    mocks.get.mockResolvedValue(
        page([
            receipt(1, 'attempt', 'pending'),
            receipt(2, 'transmitted', 'succeeded'),
            receipt(3, 'uncertain', 'uncertain'),
        ]),
    );
    await drainControlReceipts(charge.session_id);
    markReceiptSessionSaved(charge.session_id);
    mocks.append.mockRejectedValueOnce(new Error('offline'));
    await expect(syncSavedControlReceipts(charge.session_id)).rejects.toThrow('offline');
    useControlReceiptStore.setState({ collections: {} });
    restoreReceiptCollections();
    expect(receiptLogsForSave(charge.session_id, [])).toHaveLength(3);
    expect(unresolvedReceiptAttempts(receiptLogsForSave(charge.session_id, []))).toBe(1);
    mocks.get.mockResolvedValue(page([receipt(4, 'reconciliation', 'succeeded')]));
    await drainControlReceipts(charge.session_id);
    mocks.append.mockResolvedValue(true);
    await syncSavedControlReceipts(charge.session_id);
    useControlReceiptStore.setState({ collections: {} });
    restoreReceiptCollections();
    expect(useControlReceiptStore.getState().collections).toEqual({});
    expect(mocks.append).toHaveBeenLastCalledWith(
        'owner',
        charge.session_id,
        expect.arrayContaining([
            expect.objectContaining({
                control_receipt: expect.objectContaining({ receipt: expect.objectContaining({ sequence: 4 }) }),
            }),
        ]),
    );
});
