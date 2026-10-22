// @vitest-environment jsdom

import type { PendingRoastSave } from '@features/active-roast/model/pendingRoastSave';
import { useRoastingStore as store } from '@features/active-roast/model/status';
import { useRoastActions } from '@features/active-roast/model/useRoastActions';
import {
    _resetTsvWriterForTests,
    flushTsv,
    formatRoastTsvRow,
    formatTsvRows,
    replaceSessionTsv,
} from '@shared/lib/tsv-writer';
import { useSidecarPolling } from '@views/active-roast/model/useSidecarPolling';
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRoastSaveFlow } from './useRoastSaveFlow';

const mocks = vi.hoisted(() => ({
    read: vi.fn(),
    row: vi.fn(),
    start: vi.fn(),
    pidOn: vi.fn(),
    pidRenew: vi.fn(),
    save: vi.fn(),
}));
vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@entities/organization', () => ({ useActiveWorkspace: () => ({ workspaceOwnerId: 'owner' }) }));
vi.mock('@shared/lib/sidecar', () => ({
    sidecar: {
        getTemperatures: mocks.read,
        startRoast: mocks.start,
        pidOn: mocks.pidOn,
        pidRenew: mocks.pidRenew,
        getStatus: vi.fn().mockResolvedValue({
            connected: true,
            sensor_clock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
            connection_epoch: 1,
            heater_control: { generation: 1 },
        }),
        waitUntilReady: vi.fn().mockResolvedValue({ connected: true }),
    },
}));
vi.mock('@shared/lib/tsv-writer', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/tsv-writer')>();
    mocks.row.mockImplementation(actual.enqueueTsvRow);
    return { ...actual, enqueueTsvRow: mocks.row };
});
vi.mock('@entities/plan', () => ({
    useDayBatches: () => ({ data: [] }),
    planKeys: { dayBatches: (...parts: string[]) => parts },
}));
vi.mock('@features/active-roast/model/useSaveRoast', () => ({
    useSaveRoast: () => ({ resumeSave: mocks.save, isSaving: false }),
}));
vi.mock('@features/upload-roast-profile', () => ({ useUploadRoastProfile: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ message: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const clock = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1';
const processing = {
    algorithm_version: 'ema-least-squares-v1',
    temperature_unit: 'C',
    ror_unit: 'C/min',
    timestamp_clock: 'sidecar-monotonic-seconds',
    display_ema_alpha: 0.4,
    ror_ema_alpha: 0.3,
    ror_window_sec: 30,
    ror_warmup_reads: 3,
} as const;
const response = (id: string, origin = 100) => ({
    ok: true as const,
    charge: {
        session_id: id,
        charge_id: 'charge',
        machine: { machine_id: 'm', roaster_key: 'virtual', protocol: 'virtual' },
        sensor_clock: clock,
        connection_epoch: 1,
        acquired_at: origin,
        anchor: null,
        origin_kind: 'now' as const,
        accepted_at: origin,
        state: 'open' as const,
        closed_reason: null,
    },
    server_time: 105,
    elapsed_sec: 105 - origin,
});
let root: ReturnType<typeof createRoot> | undefined;
let timestamp = 100;
let sensorClock = clock;
let actions: ReturnType<typeof useRoastActions>;
let saveFlow: ReturnType<typeof useRoastSaveFlow>;
const files = new Map<string, string>();
function Probe() {
    const s = store();
    useSidecarPolling({
        isActive: true,
        phase: s.phase,
        sessionId: s.sessionId,
        pollIntervalMs: 500,
        enterPreheating: () => {},
        setConnected: () => {},
        chargeBt: 190,
    });
    const currentSaveFlow = useRoastSaveFlow({ rawBT: 190, onResetActiveRoast: () => {} });
    const currentActions = useRoastActions({
        unit: 'C',
        rawBT: 190,
        setLogEntries: vi.fn(),
        onDrop: vi.fn(),
        storeStartCharge: s.startCharge,
    });
    useEffect(() => {
        saveFlow = currentSaveFlow;
        actions = currentActions;
    }, [currentSaveFlow, currentActions]);
    return null;
}
async function mount() {
    root = createRoot(document.createElement('div'));
    await act(async () => root?.render(createElement(Probe)));
}
function unmount() {
    if (root) act(() => root?.unmount());
    root = undefined;
}
async function tick(t: number, clockOverride = clock, intervalMs = 1000) {
    timestamp = t;
    sensorClock = clockOverride;
    await act(async () => {
        await vi.advanceTimersByTimeAsync(intervalMs);
        if (store.getState().chargeRequestPending) store.getState().tick();
    });
}
beforeEach(() => {
    files.clear();
    localStorage.clear();
    mocks.save.mockReset();
    _resetTsvWriterForTests({
        write: async (path, contents, options) => {
            files.set(path, (options.append ? (files.get(path) ?? '') : '') + contents);
        },
        remove: async (path) => {
            files.delete(path);
        },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
    store.getState().reset();
    store.setState({ phase: 'standby', sidecarConnected: true });
    mocks.row.mockClear();
    mocks.start.mockReset();
    mocks.pidOn.mockClear();
    mocks.pidRenew.mockClear();
    timestamp = 100;
    sensorClock = clock;
    mocks.read.mockImplementation(async () => ({
        bt: 190,
        bt_raw: 189,
        et: 180,
        et_raw: 179,
        ror: 0,
        ror_et: 0,
        heater: 50,
        fan: 20,
        drum: 30,
        timestamp,
        sensor_clock: sensorClock,
        processing,
    }));
});
afterEach(() => {
    unmount();
    vi.useRealTimers();
});
it('retains automatic confirmation rows and pending rows across remount, rejects foreign clocks, and writes the exact anchor once', async () => {
    await mount();
    await tick(101);
    await tick(102);
    const sample = { timestamp: 100, sensorClock: clock, receivedAtMs: Date.now() - 2000, bt: 189, processing };
    let id = '';
    await act(async () => {
        id =
            store
                .getState()
                .startCharge(sample.receivedAtMs, 'owner', { bt: 189, unit: 'C', sample, awaitSidecar: true }) ?? '';
    });
    await tick(103);
    await tick(104, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:1');
    unmount();
    timestamp = 105;
    sensorClock = clock;
    await mount();
    const accepted = {
        ...response(id),
        charge: {
            ...response(id).charge,
            anchor: { sensor_clock: clock, acquired_at: 100 },
            origin_kind: 'sample' as const,
        },
    };
    await act(async () => {
        expect(store.getState().settleSidecarCharge(id, accepted, Date.now())).toBe(true);
    });
    expect(store.getState().livePoints.map((p) => [p.sensorTimestamp, p.time])).toEqual([
        [100, 0],
        [101, 1],
        [102, 2],
        [103, 3],
        [105, 5],
    ]);
    expect(
        store
            .getState()
            .livePoints.every(
                (p) =>
                    p.btRaw === 189 &&
                    p.sensorClock === clock &&
                    p.processing?.algorithm_version === processing.algorithm_version,
            ),
    ).toBe(true);
    expect(mocks.row).toHaveBeenCalledTimes(5);
    await tick(105);
    expect(mocks.row).toHaveBeenCalledTimes(5);
    await act(async () => {
        expect(store.getState().settleSidecarCharge('obsolete', response('obsolete'), Date.now())).toBe(false);
        expect(store.getState().settleSidecarCharge(id, response(id, 101), Date.now())).toBe(true);
    });
    expect(store.getState().acceptedCharge?.acquired_at).toBe(100);
});
it('keeps the existing curve when remount occurs during Drop review before cancellation', async () => {
    await mount();
    let id = '';
    await act(async () => {
        id = store.getState().startCharge(undefined, 'owner', { bt: 190, unit: 'C', awaitSidecar: true }) ?? '';
        store.getState().settleSidecarCharge(id, response(id), Date.now());
    });
    await tick(101);
    await tick(102);
    const before = store.getState().livePoints;
    expect(before.length).toBeGreaterThan(0);
    await act(async () => {
        expect(store.getState().drop({ rawBT: 190, unit: 'C', replayActive: false })).not.toBeNull();
    });
    unmount();
    timestamp = 103;
    await mount();
    vi.setSystemTime(new Date('2026-10-22T01:00:00Z'));
    await act(async () => {
        expect(store.getState().cancelDrop(id)).not.toBeNull();
    });
    expect(store.getState().acceptedCharge?.acquired_at).toBe(100);
    expect(store.getState().livePoints.filter((p) => (p.sensorTimestamp ?? Infinity) <= 102)).toEqual(before);
    await tick(104);
    const resumed = store.getState().livePoints;
    expect(resumed[resumed.length - 1]?.time).toBe(4);
});
it.each(['before', 'after'] as const)(
    'settles a deferred Charge response %s Drop cancellation without restarting control',
    async (order) => {
        let resolveStart: (value: ReturnType<typeof response>) => void = () => {
            throw new Error('start was not called');
        };
        mocks.start.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveStart = resolve;
                }),
        );
        await mount();
        await act(async () => actions.triggerCharge());
        const id = store.getState().sessionId ?? '';
        await tick(101);
        await act(async () => {
            expect(store.getState().drop({ rawBT: 190, unit: 'C', replayActive: false })).not.toBeNull();
        });
        if (order === 'before') {
            await act(async () => resolveStart(response(id)));
            expect(store.getState().completed?.snapshot.chargeRequestPending).toBe(false);
            expect(store.getState().completed?.snapshot.livePoints.some((p) => p.sensorTimestamp === 101)).toBe(true);
        }
        await act(async () => {
            expect(store.getState().cancelDrop(id)).not.toBeNull();
        });
        if (order === 'after') await act(async () => resolveStart(response(id)));
        await tick(102);
        await tick(103);
        expect.soft(store.getState().chargeRequestPending).toBe(false);
        expect.soft(store.getState().livePoints.some((p) => p.sensorTimestamp === 103)).toBe(true);
        expect(mocks.pidOn).not.toHaveBeenCalled();
        expect(mocks.pidRenew).not.toHaveBeenCalled();
    },
);

it('settles only the completed owner after a new batch starts and rejects a reset owner', async () => {
    await mount();
    let first = '';
    await act(async () => {
        first = store.getState().startCharge(undefined, 'owner-a', { bt: 190, unit: 'C', awaitSidecar: true }) ?? '';
    });
    await tick(101);
    let next = '';
    await act(async () => {
        store.getState().drop({ rawBT: 190, unit: 'C', replayActive: false });
        next = store.getState().startCharge(undefined, 'owner-b', { bt: 190, unit: 'C', awaitSidecar: true }) ?? '';
    });
    const current = store.getState();
    await act(async () => {
        expect(current.settleSidecarCharge(first, response(first), Date.now())).toBe(true);
    });
    expect(store.getState()).toMatchObject({
        sessionId: next,
        sessionOwnerId: 'owner-b',
        acceptedCharge: null,
        chargeRequestPending: true,
    });
    expect(store.getState().completed?.snapshot).toMatchObject({
        sessionId: first,
        sessionOwnerId: 'owner-a',
        chargeRequestPending: false,
    });
    expect(store.getState().completed?.snapshot.livePoints.some((point) => point.sensorTimestamp === 101)).toBe(true);
    expect(store.getState().cancelDrop(first)).toBeNull();
    await act(async () => store.getState().reset());
    expect(store.getState().settleSidecarCharge(next, response(next), Date.now())).toBe(false);
    expect(store.getState().sessionId).toBeNull();
});

it('keeps acquired rows if the start request fails while Drop review is open', async () => {
    await mount();
    let id = '';
    await act(async () => {
        id = store.getState().startCharge(undefined, 'owner', { bt: 190, unit: 'C', awaitSidecar: true }) ?? '';
    });
    await tick(101);
    await tick(102);
    await act(async () => store.getState().drop({ rawBT: 190, unit: 'C', replayActive: false }));
    await act(async () => {
        expect(store.getState().settleSidecarCharge(id, null, Date.now())).toBe(true);
    });
    const completed = store.getState().completed;
    expect(completed?.snapshot.chargeRequestPending).toBe(false);
    expect(
        completed?.snapshot.livePoints
            .filter((point) => point.sensorTimestamp != null)
            .map((point) => point.sensorTimestamp),
    ).toEqual([100, 101, 102]);
    expect(completed?.restore?.livePoints).toEqual(completed?.snapshot.livePoints);
    await act(async () => store.getState().cancelDrop(id));
    await tick(103);
    const resumed = store.getState().livePoints;
    expect(resumed[resumed.length - 1]?.sensorTimestamp).toBe(103);
});

it('writes every pending raw TSV row before a Save started during Drop review can upload', async () => {
    let resolveStart: (value: ReturnType<typeof response>) => void = () => {
        throw new Error('start was not called');
    };
    mocks.start.mockImplementation(
        () =>
            new Promise((resolve) => {
                resolveStart = resolve;
            }),
    );
    await mount();
    await act(async () => actions.triggerCharge());
    const id = store.getState().sessionId ?? '';
    await tick(101);
    await tick(102);
    await act(async () => {
        const dropped = store.getState().drop({ rawBT: 190, unit: 'C', replayActive: false });
        if (!dropped) throw new Error('Drop failed');
        saveFlow.confirmEndRoast(dropped.summary);
        await replaceSessionTsv(id, formatTsvRows(dropped.snapshot.livePoints, formatRoastTsvRow));
    });
    const uploaded: string[] = [];
    mocks.save.mockImplementation(async (pending: PendingRoastSave) => {
        await flushTsv(pending.params.sessionId ?? undefined);
        uploaded.push(files.get(`session_${id}.tsv`) ?? '');
        return { syncPending: false, savedSession: { id, plan_batch_id: null } };
    });
    let saving: Promise<void> | undefined;
    await act(async () => {
        saving = saveFlow.handleSave({
            notes: '',
            weightGrams: 1,
            roastLevel: null,
            beanId: null,
            beanLabel: 'Sample',
            linkMode: 'none',
            planBatchId: null,
            deductStock: false,
        });
        await Promise.resolve();
    });
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => resolveStart(response(id)));
    await act(async () => {
        await saving;
    });
    expect(uploaded).toHaveLength(1);
    const rows = uploaded[0]
        .split('\n')
        .filter((row) => /^\d/.test(row))
        .map((row) => row.split('\t'));
    expect(rows.map((row) => [row[0], row[9], row[11], row[12]])).toEqual([
        ['0.00', '189', '100', clock],
        ['1.00', '189', '101', clock],
        ['2.00', '189', '102', clock],
    ]);
    expect(uploaded[0]).toContain(`# processing\t${JSON.stringify(processing)}`);
});

it.each([
    {
        mode: 'backdated',
        samples: [101, 102, 103, 104],
        intervalMs: 1000,
        onset: { timeSec: 2, bt: 189 },
        end: 2,
        expected: [0, 1, 2],
    },
    { mode: 'manual', samples: [100.5, 101, 101.5], intervalMs: 500, onset: undefined, end: 1, expected: [0, 0.5, 1] },
])(
    'keeps the $mode Drop boundary in the curve, restore snapshot, and real TSV after late acceptance',
    async ({ samples, intervalMs, onset, end, expected }) => {
        await mount();
        const sample = { timestamp: 100, sensorClock: clock, receivedAtMs: Date.now(), bt: 189, processing };
        let id = '';
        await act(async () => {
            id =
                store
                    .getState()
                    .startCharge(sample.receivedAtMs, 'owner', { bt: 189, unit: 'C', sample, awaitSidecar: true }) ??
                '';
        });
        for (const timestamp of samples) await tick(timestamp, clock, intervalMs);
        await act(async () => {
            const dropped = store.getState().drop({ rawBT: 190, unit: 'C', replayActive: false, onset });
            if (!dropped) throw new Error('Drop failed');
            expect(dropped.dropTimeSec).toBe(end);
            saveFlow.confirmEndRoast(dropped.summary);
            await replaceSessionTsv(id, formatTsvRows(dropped.snapshot.livePoints, formatRoastTsvRow));
        });
        await act(async () => {
            store.getState().settleSidecarCharge(
                id,
                {
                    ...response(id),
                    charge: {
                        ...response(id).charge,
                        origin_kind: 'sample',
                        anchor: { sensor_clock: clock, acquired_at: 100 },
                    },
                },
                Date.now(),
            );
        });
        await flushTsv(id);
        const completed = store.getState().completed;
        expect(completed?.snapshot.logEntries.find((entry) => entry.event === 'Drop')?.timeSec).toBe(end);
        expect(completed?.snapshot.livePoints.map((point) => point.time)).toEqual(expected);
        expect(completed?.restore?.livePoints).toEqual(completed?.snapshot.livePoints);
        const rows = (files.get(`session_${id}.tsv`) ?? '')
            .split('\n')
            .filter((row) => /^\d/.test(row))
            .map((row) => row.split('\t'));
        expect(rows.map((row) => [Number(row[0]), Number(row[11]), row[12]])).toEqual(
            expected.map((time) => [time, time + 100, clock]),
        );
        mocks.read.mockReturnValueOnce(new Promise(() => {}));
        await act(async () => {
            store.getState().cancelDrop(id);
        });
        expect(store.getState().livePoints.map((point) => point.time)).toEqual(expected);
    },
);
