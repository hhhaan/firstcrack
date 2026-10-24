// @vitest-environment jsdom

import { unresolvedReceiptAttempts } from '@features/active-roast/lib/control-receipts';
import { parseStoredRoastEvents, serializeRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import {
    drainControlReceipts,
    markReceiptSessionSaved,
    pruneReceiptCollections,
    receiptLogsForSave,
    registerReceiptCollection,
    restoreReceiptCollections,
    syncSavedControlReceipts,
    useControlReceiptStore,
} from '@features/active-roast/model/controlReceiptCollector';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { Charge, CommandReceipt, ReceiptPage } from '@shared/types/sidecar';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), append: vi.fn() }));
vi.mock('@shared/lib/sidecar', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@shared/lib/sidecar')>()),
    sidecar: { getPidReceipts: mocks.get },
}));
vi.mock('@entities/roast', () => ({ roastSessionApi: { appendControlReceipts: mocks.append } }));
const charge: Charge = {
    session_id: '11111111-1111-4111-8111-111111111111',
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
    sealed: false,
    gap: null,
    receipts,
    ...extra,
});
beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.get.mockReset();
    mocks.append.mockReset();
    useControlReceiptStore.setState({ collections: {} });
    useRoastingStore.getState().reset();
    registerReceiptCollection(charge, 'owner');
});

import { resumePendingRoastSave } from '@features/active-roast/lib/resumePendingRoastSave';
import {
    clearPendingRoastSave,
    createPendingRoastSave,
    readPendingControlReceipts,
    readPendingRoastSave,
    writePendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import { type SaveRoastDeps, saveRoastCore } from '@features/active-roast/model/useSaveRoast';
import { QueryClient } from '@tanstack/react-query';

const params: Parameters<typeof saveRoastCore>[1] = {
    formData: { notes: '', weightGrams: 1, roastLevel: null, beanId: null, beanLabel: 'test', deductStock: false },
    sessionId: charge.session_id,
    userId: 'owner',
    elapsed: 20,
    roastStartTime: 1750000000000,
    rawBT: 120,
    selectedBeanId: null,
    targetProfileId: null,
    planBatchHandoff: null,
    handoffBeanName: null,
    logEntries: [],
};
const deps = (saveOp: SaveRoastDeps['saveOp']): SaveRoastDeps => ({
    plan: 'pro',
    qc: new QueryClient(),
    countCompletedThisMonth: vi.fn().mockResolvedValue(0),
    countCompletedTotal: vi.fn().mockResolvedValue(0),
    saveOp,
    flushCurve: vi.fn().mockResolvedValue(undefined),
});

it('keeps sealed saved evidence while its pending save coordinator still owns the session', async () => {
    mocks.get.mockResolvedValue(page([receipt(1, 'completed', 'succeeded')], { sealed: true }));
    await drainControlReceipts(charge.session_id);
    writePendingRoastSave(createPendingRoastSave(params, true));
    markReceiptSessionSaved(charge.session_id);
    mocks.append.mockResolvedValue(true);
    await syncSavedControlReceipts(charge.session_id);
    pruneReceiptCollections();
    expect(useControlReceiptStore.getState().collections[charge.session_id]).toBeDefined();
    clearPendingRoastSave(params.userId, charge.session_id);
    pruneReceiptCollections();
    expect(useControlReceiptStore.getState().collections).toEqual({});
});

it('restores legacy receipt checkpoints as unsealed so late evidence remains collectible', async () => {
    mocks.get.mockResolvedValue(page([receipt(1, 'uncertain', 'uncertain')]));
    await drainControlReceipts(charge.session_id);
    markReceiptSessionSaved(charge.session_id);
    const current = useControlReceiptStore.getState().collections[charge.session_id];
    localStorage.setItem(
        'fc_pending_control_receipts',
        JSON.stringify([{ ...current, sealed: undefined, discarded: undefined }]),
    );
    useControlReceiptStore.setState({ collections: {} });
    restoreReceiptCollections();
    mocks.get.mockResolvedValue(page([receipt(2, 'reconciliation', 'succeeded')]));
    await drainControlReceipts(charge.session_id);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(unresolvedReceiptAttempts(receiptLogsForSave(charge.session_id, []))).toBe(0);
});
it('preserves negative and post-Drop elapsed and immutable uncertain then reconciliation across JSON', async () => {
    const rows = [
        { ...receipt(1, 'attempt', 'pending'), elapsed_sec: -1 },
        { ...receipt(2, 'uncertain', 'uncertain'), elapsed_sec: 21 },
        { ...receipt(3, 'reconciliation', 'succeeded'), elapsed_sec: 30 },
    ];
    mocks.get.mockResolvedValue(page(rows));
    useRoastingStore.setState({ sessionId: 'next', logState: { entries: [], unwind: false } });
    await drainControlReceipts(charge.session_id);
    const saved = serializeRoastEvents(receiptLogsForSave(charge.session_id, []));
    expect(saved.map((e) => e.time_sec)).toEqual([-1, 21, 30]);
    expect(parseStoredRoastEvents(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(saved[1].control_receipt).toMatchObject({ receipt: { event: 'uncertain', outcome: 'uncertain' } });
    expect(unresolvedReceiptAttempts(receiptLogsForSave(charge.session_id, []))).toBe(0);
    expect(useRoastingStore.getState().logState.entries).toEqual([]);
});
it('keeps late unsynced receipts durable while an older CAS append is in flight', async () => {
    mocks.get.mockResolvedValueOnce(page([receipt(1, 'attempt', 'pending')]));
    await drainControlReceipts(charge.session_id);
    markReceiptSessionSaved(charge.session_id);
    let release: (value: boolean) => void = () => {
        throw new Error('missing append');
    };
    mocks.append.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                release = resolve;
            }),
    );
    const syncing = syncSavedControlReceipts(charge.session_id);
    mocks.get.mockResolvedValueOnce(page([receipt(2, 'completed', 'succeeded')]));
    await drainControlReceipts(charge.session_id);
    release(true);
    await syncing;
    useControlReceiptStore.setState({ collections: {} });
    restoreReceiptCollections();
    expect(receiptLogsForSave(charge.session_id, [])).toHaveLength(2);
    mocks.append.mockResolvedValueOnce(true);
    await syncSavedControlReceipts(charge.session_id);
    expect(readPendingControlReceipts()).toEqual([]);
});
it('drains a blocked known cursor before real saveCore can write the session', async () => {
    let release: (value: ReceiptPage) => void = () => {
        throw new Error('missing page');
    };
    mocks.get
        .mockResolvedValueOnce(page([receipt(1, 'attempt', 'pending')], { next_sequence: 3, has_more: true }))
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
        );
    const save = vi
        .fn()
        .mockResolvedValue({ id: charge.session_id, user_id: 'owner', status: 'completed', plan_batch_id: null });
    const saving = saveRoastCore(deps(save), params);
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(save).not.toHaveBeenCalled();
    release(page([receipt(2, 'completed', 'succeeded')]));
    await saving;
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].session.events).toHaveLength(2);
    expect(readPendingControlReceipts()).not.toEqual([]);
});
it('marks an impossible empty page with cursor advancement unavailable without skipping evidence', async () => {
    mocks.get.mockResolvedValue(page([], { next_sequence: 4, next_after: 3, has_more: false }));
    await drainControlReceipts(charge.session_id);
    expect.soft(useControlReceiptStore.getState().collections[charge.session_id].unavailable).toBe(true);
    expect.soft(useControlReceiptStore.getState().collections[charge.session_id].after).toBe(0);
    expect
        .soft(receiptLogsForSave(charge.session_id, []))
        .toEqual([expect.objectContaining({ controlReceipt: expect.objectContaining({ kind: 'unavailable' }) })]);
});
it('does not discard late evidence after a lost save response has been verified while upload waits', async () => {
    const initial = [receipt(1, 'attempt', 'pending'), receipt(2, 'uncertain', 'uncertain')];
    mocks.get.mockResolvedValueOnce(page(initial));
    let dbEvents: unknown[] = [];
    const saved = { id: charge.session_id, user_id: 'owner', status: 'completed', plan_batch_id: null };
    const save = vi.fn().mockImplementation(async (payload) => {
        dbEvents = payload.session.events;
        mocks.get.mockResolvedValueOnce(page([receipt(3, 'reconciliation', 'succeeded')]));
        await drainControlReceipts(charge.session_id);
        throw new Error('response lost after server commit');
    });
    const findSession = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(saved);
    const pending = createPendingRoastSave(params, true);
    writePendingRoastSave(pending);
    let release: () => void = () => {
        throw new Error('missing upload');
    };
    const upload = vi.fn().mockImplementation(
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    const saving = resumePendingRoastSave({
        pending,
        ownerId: 'owner',
        ensureAccess: async () => {},
        findSession,
        resolveForRoast: vi.fn(),
        saveRoast: (p) => saveRoastCore(deps(save), p),
        syncBatch: async () => {},
        syncRoastCurve: upload,
    });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(dbEvents).toHaveLength(2);
    expect(readPendingRoastSave('owner', charge.session_id)?.db).toBe('saved');
    useControlReceiptStore.setState({ collections: {} });
    restoreReceiptCollections();
    const durable = [
        ...receiptLogsForSave(charge.session_id, []),
        ...(readPendingRoastSave('owner', charge.session_id)?.params.logEntries ?? []),
    ];
    expect
        .soft(durable.some((e) => e.controlReceipt?.kind === 'receipt' && e.controlReceipt.receipt.sequence === 3))
        .toBe(true);
    release();
    await saving;
});

it('recovers late receipt evidence from an interrupted save checkpoint when the committed row already exists after restart', async () => {
    mocks.get.mockResolvedValueOnce(page([receipt(1, 'attempt', 'pending'), receipt(2, 'uncertain', 'uncertain')]));
    const pending = createPendingRoastSave(params, true);
    writePendingRoastSave(pending);
    await drainControlReceipts(charge.session_id);
    const committedEvents = serializeRoastEvents(receiptLogsForSave(charge.session_id, []));
    mocks.get.mockResolvedValueOnce(page([receipt(3, 'reconciliation', 'succeeded')]));
    await drainControlReceipts(charge.session_id);
    expect(readPendingRoastSave('owner', charge.session_id)?.params.logEntries).toHaveLength(3);
    expect(readPendingControlReceipts()).toEqual([]);
    useControlReceiptStore.setState({ collections: {} });
    useRoastingStore.getState().reset();
    restoreReceiptCollections();
    const recovered = readPendingRoastSave('owner', charge.session_id);
    if (!recovered) throw new Error('missing durable checkpoint');
    const saveAgain = vi.fn();
    await resumePendingRoastSave({
        pending: recovered,
        ownerId: 'owner',
        ensureAccess: async () => {},
        findSession: vi.fn().mockResolvedValue({
            id: charge.session_id,
            user_id: 'owner',
            status: 'completed',
            plan_batch_id: null,
            events: committedEvents,
        }),
        resolveForRoast: vi.fn(),
        saveRoast: saveAgain,
        syncBatch: async () => {},
        syncRoastCurve: async () => {},
    });
    markReceiptSessionSaved(charge.session_id);
    await syncSavedControlReceipts(charge.session_id);
    expect(saveAgain).not.toHaveBeenCalled();
    expect.soft(mocks.append).toHaveBeenCalledWith(
        'owner',
        charge.session_id,
        expect.arrayContaining([
            expect.objectContaining({
                control_receipt: expect.objectContaining({ receipt: expect.objectContaining({ sequence: 3 }) }),
            }),
        ]),
    );
    const queue = readPendingControlReceipts();
    expect
        .soft(
            readPendingRoastSave('owner', charge.session_id) !== null ||
                (Array.isArray(queue) && queue.length > 0) ||
                mocks.append.mock.calls.length > 0,
        )
        .toBe(true);
});
it('reports outbox write failure, preserves prior durable bytes, and retries after storage recovers', async () => {
    mocks.get.mockResolvedValueOnce(page([receipt(1, 'attempt', 'pending')]));
    await drainControlReceipts(charge.session_id);
    markReceiptSessionSaved(charge.session_id);
    const before = localStorage.getItem('fc_pending_control_receipts');
    const realSet = Storage.prototype.setItem;
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key === 'fc_pending_control_receipts') throw new Error('quota exceeded');
        realSet.call(this, key, value);
    });
    mocks.get.mockResolvedValueOnce(page([receipt(2, 'completed', 'succeeded')]));
    await expect(drainControlReceipts(charge.session_id)).rejects.toThrow('quota exceeded');
    expect(localStorage.getItem('fc_pending_control_receipts')).toBe(before);
    expect(useControlReceiptStore.getState().collections[charge.session_id].unavailable).toBe(true);
    failure.mockRestore();
    mocks.get.mockResolvedValueOnce(page([], { next_after: 2, next_sequence: 3 }));
    await drainControlReceipts(charge.session_id);
    useControlReceiptStore.setState({ collections: {} });
    restoreReceiptCollections();
    expect(
        receiptLogsForSave(charge.session_id, []).some(
            (e) => e.controlReceipt?.kind === 'receipt' && e.controlReceipt.receipt.sequence === 2,
        ),
    ).toBe(true);
});
