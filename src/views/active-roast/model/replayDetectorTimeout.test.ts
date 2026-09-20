// @vitest-environment jsdom
/**
 * #368 R09 P2 — Replay timeout must use the same observation as the real detector.
 * Stubbing confirmedTP on the Replay hook hides the lag: detection is computed
 * this render, and Replay must see that result on the same observation.
 */

import { useRoastingStore } from '@features/active-roast/model/status';
import { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import { PROPOSED_TP_UNCONFIRMED_LIMIT_S, type ReplayPoint } from '@features/machine-control/lib/replay';
import { useReplayControl } from '@features/machine-control/model/useReplayControl';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIMIT = PROPOSED_TP_UNCONFIRMED_LIMIT_S;

/** Pending BT after a reference TP — timeout only applies when BT events remain. */
const POINTS: ReplayPoint[] = [
    { t: 0, bt: 180, heater: 80 },
    { t: 60, bt: 95, heater: 80 },
    { t: 120, bt: 110, heater: 60 },
    { t: 300, bt: 155, heater: 40 },
];

type Point = { time: number; bt: number };

/** Reviewer series: no detect at 119 (rise not monotonic over 3s), real detect at 120. */
const DETECT_AT_LIMIT: Point[] = [
    { time: 0, bt: 180 },
    { time: 116, bt: 101 },
    { time: 117, bt: 100 },
    { time: 118, bt: 101 },
    { time: 119, bt: 102 },
    { time: 120, bt: 103 },
    { time: 121, bt: 104 },
];

/** Keeps falling through 120 — no 3s monotonic rise, so detector misses. */
const MISS_AT_LIMIT: Point[] = [
    { time: 0, bt: 180 },
    { time: 116, bt: 101 },
    { time: 117, bt: 100 },
    { time: 118, bt: 99 },
    { time: 119, bt: 98 },
    { time: 120, bt: 97 },
    { time: 121, bt: 96 },
];

/** After a miss at 120, a later 3s rise would be a real TP — must not auto-On. */
const LATE_AFTER_MISS: Point[] = [
    ...MISS_AT_LIMIT,
    { time: 122, bt: 97 },
    { time: 123, bt: 98 },
    { time: 124, bt: 99 },
    { time: 125, bt: 100 },
];

const until = (series: Point[], t: number) => series.filter((p) => p.time <= t);
const at = (series: Point[], t: number) => series.find((p) => p.time === t)?.bt ?? series[0].bt;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
    act(() => {
        for (const root of roots.splice(0)) root.unmount();
        useRoastingStore.getState().reset();
    });
});

type Latest = {
    replay: ReturnType<typeof useReplayControl>;
    confirmedTP: ReturnType<typeof useAutoDetection>['confirmedTP'];
};

type WireProps = {
    livePoints: Point[];
    elapsed: number;
    liveBt: number;
    writeHeater: (v: number) => Promise<number | null>;
};

/** Same tree as ActiveRoast: detector parent, Replay child. Sibling hooks would let a discarded first pass still commit Replay's timeout setState. */
const ReplayChild = ({
    confirmedTP,
    elapsed,
    liveBt,
    writeHeater,
    onReplay,
}: {
    confirmedTP: Latest['confirmedTP'];
    elapsed: number;
    liveBt: number;
    writeHeater: WireProps['writeHeater'];
    onReplay: (replay: Latest['replay']) => void;
}) => {
    const replay = useReplayControl({
        referencePoints: POINTS,
        referenceMachineMismatch: false,
        referenceDropTime: null,
        liveBt,
        elapsed,
        roasting: true,
        confirmedTurningPoint: confirmedTP,
        heaterWritable: true,
        pidEngaged: false,
        roastFinished: false,
        sidecarConnected: true,
        heaterUnacknowledged: false,
        dropBehavior: 'hold',
        heaterFeedback: null,
        heaterPending: false,
        reconnecting: false,
        writeHeater,
    });
    onReplay(replay);
    return null;
};

const renderWired = () => {
    const writeHeater = vi.fn(async (value: number): Promise<number | null> => value);
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    let latest!: Latest;
    const Parent = ({ livePoints, elapsed, liveBt }: Omit<WireProps, 'writeHeater'>) => {
        const det = useAutoDetection({
            livePoints,
            onAutoCharge: () => {},
            onAutoDrop: () => {},
            onTurningPoint: () => {},
            autoChargeEnabled: false,
            autoChargeMode: 'standard',
            pollIntervalMs: 1000,
            autoDropEnabled: false,
            autoDropMode: 'standard',
            yellowTempC: 150,
            unit: 'C',
            logEntries: [],
            autoYellowEnabled: false,
        });
        latest = { ...latest, confirmedTP: det.confirmedTP };
        return createElement(ReplayChild, {
            confirmedTP: det.confirmedTP,
            elapsed,
            liveBt,
            writeHeater,
            onReplay: (replay) => {
                latest = { ...latest, replay };
            },
        });
    };
    const paint = (elapsed: number, series: Point[]) => {
        const liveBt = at(series, elapsed);
        act(() => {
            useRoastingStore.setState({
                phase: 'roasting',
                elapsed,
                liveData: { bt: liveBt, et: null, ror: 0, ror_et: 0, heater: 0, fan: 0, drum: 0 },
            });
        });
        act(() => root.render(createElement(Parent, { livePoints: until(series, elapsed), elapsed, liveBt })));
    };
    paint(0, DETECT_AT_LIMIT);
    return { get: () => latest, paint, writeHeater };
};

/** SAMPLE_GAP is 5s — step by 5 until near the limit, then 1s. */
const runTo = (h: { paint: (elapsed: number, series: Point[]) => void }, series: Point[], to: number) => {
    for (let e = 5; e < to; e += e >= LIMIT - 2 ? 1 : 5) h.paint(e, series);
    h.paint(to, series);
};

describe('Replay TP timeout vs real detector (#368 R09 P2)', () => {
    beforeEach(() => {
        act(() => useRoastingStore.getState().reset());
    });

    it('119 holds; 120/121 real detect on that tick wins over timeout — no auto-stop', async () => {
        const h = renderWired();
        await act(async () => h.get().replay.toggle());
        expect(h.get().replay.active).toBe(true);
        h.writeHeater.mockClear();

        runTo(h, DETECT_AT_LIMIT, LIMIT - 1);
        expect(h.get().replay.active).toBe(true);
        expect(h.get().confirmedTP).toBeNull();
        expect(h.get().replay.stopReason).toBeNull();

        h.paint(LIMIT, DETECT_AT_LIMIT);
        expect(h.get().confirmedTP?.fallback).toBeFalsy();
        expect(h.get().confirmedTP).not.toBeNull();
        expect(h.get().replay.active).toBe(true);
        expect(h.get().replay.stopReason).not.toBe('tpUnconfirmed');
        expect(h.writeHeater).not.toHaveBeenCalled();

        h.paint(LIMIT + 1, DETECT_AT_LIMIT);
        expect(h.get().replay.active).toBe(true);
        expect(h.get().replay.stopReason).not.toBe('tpUnconfirmed');
    });

    it('120s with a real miss/fallback still stops Replay', async () => {
        const h = renderWired();
        await act(async () => h.get().replay.toggle());
        runTo(h, MISS_AT_LIMIT, LIMIT - 1);
        expect(h.get().replay.active).toBe(true);

        h.paint(LIMIT, MISS_AT_LIMIT);
        expect(h.get().replay.active).toBe(false);
        expect(h.get().replay.stopReason).toBe('tpUnconfirmed');
        expect(h.get().confirmedTP?.fallback).not.toBe(false);
    });

    it('late real TP after a genuine timeout does not auto-resume', async () => {
        const h = renderWired();
        await act(async () => h.get().replay.toggle());
        runTo(h, MISS_AT_LIMIT, LIMIT);
        expect(h.get().replay.active).toBe(false);
        expect(h.get().replay.stopReason).toBe('tpUnconfirmed');

        h.paint(125, LATE_AFTER_MISS);
        expect(h.get().confirmedTP?.fallback).toBeFalsy();
        expect(h.get().confirmedTP).not.toBeNull();
        expect(h.get().replay.active).toBe(false);
        expect(h.get().replay.stopReason).toBe('tpUnconfirmed');
    });
});
