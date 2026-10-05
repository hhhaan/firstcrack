// @vitest-environment jsdom
import { i18n } from '@shared/i18n';
import { useToastStore } from '@shared/store/toast';
import type { LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { useAutoDetection } from './useAutoDetection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Point = { time: number; bt: number; btRaw?: number | null };

type Props = {
    livePoints: Point[];
    markEvent: (
        event: string,
        note: string,
        buttonLabel?: string,
        historical?: { timeSec: number; tempC: number | null },
    ) => void;
    logEntries?: LogEntry[];
    autoYellowEnabled?: boolean;
    autoChargeEnabled?: boolean;
    autoChargeMode?: 'standard' | 'sensitive';
    autoDropEnabled?: boolean;
    autoDropMode?: 'standard' | 'sensitive';
    autoDropStartMin?: number;
    pollIntervalMs?: 500 | 1000;
    onAutoCharge?: (bt: number, timeMs?: number) => void;
    onAutoDrop?: (onset?: { timeSec: number; bt: number }) => void;
    onTurningPoint?: (tp: { timeSec: number; temp: number; fallback?: boolean }) => void;
};

const noop = () => {};
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
    vi.useRealTimers();
    act(() => {
        for (const root of roots.splice(0)) root.unmount();
        useRoastingStore.getState().reset();
        useToastStore.setState({ toasts: [] });
    });
});

/** Render the real hook and expose its return value + a way to push new props. */
const renderAutoDetection = (initial: Props) => {
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    let latest: ReturnType<typeof useAutoDetection>;

    const Probe = (p: Props) => {
        latest = useAutoDetection({
            livePoints: p.livePoints,
            onAutoCharge: p.onAutoCharge ?? noop,
            onAutoDrop: p.onAutoDrop ?? noop,
            onTurningPoint: p.onTurningPoint ?? noop,
            autoChargeEnabled: p.autoChargeEnabled ?? true,
            autoChargeMode: p.autoChargeMode ?? 'standard',
            pollIntervalMs: p.pollIntervalMs ?? 500,
            autoDropEnabled: p.autoDropEnabled ?? true,
            autoDropMode: p.autoDropMode ?? 'standard',
            autoDropStartMin: p.autoDropStartMin ?? 7,
            yellowTempC: 150,
            unit: 'C',
            markEvent: p.markEvent,
            logEntries: p.logEntries ?? [],
            autoYellowEnabled: p.autoYellowEnabled ?? true,
        });
        return null;
    };

    const render = (p: Props) => void act(() => root.render(createElement(Probe, p)));
    render(initial);
    return {
        render,
        get result() {
            return latest;
        },
    };
};

/** Advance the roast one poll tick: new BT (and optionally elapsed) then re-render. */
const tick = (h: { render: (p: Props) => void }, props: Props, bt: number, elapsed?: number) => {
    void act(() => {
        useRoastingStore.setState({
            phase: 'roasting',
            sidecarConnected: true,
            ...(elapsed != null ? { elapsed } : {}),
            liveData: { bt, et: null, ror: 0, ror_et: 0, heater: 0, fan: 0, drum: 0 },
        });
    });
    h.render(props);
};

/** Display `bt` is a decoy. TP/Yellow must read `btRaw`. */
const rawSeries = (until: number, btRawAt: (t: number) => number, btAt: (t: number) => number = () => 180): Point[] => {
    const pts: Point[] = [];
    for (let t = 0; t <= until; t += 0.5) pts.push({ time: t, bt: btAt(t), btRaw: btRawAt(t) });
    return pts;
};

/** Strictly rising EMA. Using it would confirm a real TP at t=0 and cross 150°C. */
const risingEma = (t: number) => 140 + t * 0.2;

const realRawAt = (t: number) => 90 + 95 * Math.exp(-t / 20) + 0.18 * t;
const realTpPoints = (until = 200) => rawSeries(until, realRawAt);

/** Slow profile whose valley lands at ≈126.5s — after the 120s fallback timeout. */
const lateRawAt = (t: number) => 90 + 95 * Math.exp(-t / 40) + 0.1 * t;
const lateTpPoints = (until: number) => rawSeries(until, lateRawAt);

/** Decline, then a rise through 150°C that is still shorter than the 3s TP trigger at 120s. */
const earlyCrossRawAt = (t: number) => (t <= 119 ? 200 - (52 * t) / 119 : 148 + 2.5 * (t - 119));

/** Hot-drum charge: raw falls through 150°C. The decoy EMA rises through it. */
const descentRawAt = (t: number) => 210 - 0.5 * t;

/**
 * Cross 150°C, fall back through it (latch release), sit below until the fallback,
 * then cross again. Slopes stay inside the glitch filter.
 */
const releasedCrossRawAt = (t: number) => {
    if (t <= 30) return 200 - 2 * t;
    if (t <= 40) return 140 + 2 * (t - 30);
    if (t <= 50) return 160 - 2 * (t - 40);
    if (t <= 120) return 140;
    return 140 + 2 * (t - 120);
};

describe('useAutoDetection — fallback TP is provisional', () => {
    beforeEach(() => {
        void act(() => useRoastingStore.getState().reset());
    });

    it('promotes a real detection over a fallback TP confirmed earlier', () => {
        const onTurningPoint = vi.fn();
        // 120s 시점: 골짜기(≈126.5s) 이전이라 실감지 불가 → 폴백이 현재 시각/온도로 확정
        let props: Props = { livePoints: lateTpPoints(120), markEvent: vi.fn(), onTurningPoint };
        const h = renderAutoDetection(props);

        tick(h, props, 42, 120);
        expect(h.result.confirmedTP?.fallback).toBe(true);
        expect(h.result.confirmedTP?.timeSec).toBe(120);
        expect(h.result.confirmedTP?.temp).toBeCloseTo(lateRawAt(120), 5);
        expect(h.result.confirmedTP?.temp).not.toBe(180);
        expect(onTurningPoint).toHaveBeenCalledTimes(1);

        // 폴링이 골짜기를 지나 상승 구간까지 진행 → 실감지가 폴백을 교체하고 한 번 더 발화
        props = { ...props, livePoints: lateTpPoints(140) };
        tick(h, props, 108, 140);
        expect(h.result.confirmedTP?.fallback).toBeFalsy();
        expect(h.result.confirmedTP?.timeSec).toBeCloseTo(126.5, 1);
        expect(onTurningPoint).toHaveBeenCalledTimes(2);
    });

    it('keeps a dragged TP when a later valley would have confirmed', () => {
        const onTurningPoint = vi.fn();
        let props: Props = { livePoints: lateTpPoints(40), markEvent: vi.fn(), onTurningPoint };
        const h = renderAutoDetection(props);

        tick(h, props, 100, 40);
        act(() => h.result.moveTurningPoint(30, 95));
        expect(h.result.confirmedTP).toEqual({ timeSec: 30, temp: 95, fallback: false });

        props = { ...props, livePoints: lateTpPoints(160) };
        tick(h, props, 120, 160);
        expect(h.result.confirmedTP).toEqual({ timeSec: 30, temp: 95, fallback: false });
        expect(onTurningPoint).toHaveBeenCalledTimes(1);
        expect(onTurningPoint).toHaveBeenCalledWith({ timeSec: 30, temp: 95, fallback: false });
    });

    it('never re-fires once a real TP is confirmed', () => {
        const onTurningPoint = vi.fn();
        let props: Props = { livePoints: lateTpPoints(140), markEvent: vi.fn(), onTurningPoint };
        const h = renderAutoDetection(props);

        tick(h, props, 108, 140);
        expect(h.result.confirmedTP?.fallback).toBeFalsy();

        props = { ...props, livePoints: lateTpPoints(200) };
        tick(h, props, 130, 200);
        expect(onTurningPoint).toHaveBeenCalledTimes(1);
    });
});

describe('useAutoDetection — Yellow gating (no FC auto)', () => {
    beforeEach(() => {
        void act(() => useRoastingStore.getState().reset());
    });

    it('fires Yellow after the TP fallback even though the crossing happened before the gate opened', () => {
        // Raw rise through 150°C is shorter than the TP trigger, so the 120s fallback opens the gate.
        // The crossing is on btRaw; display EMA and liveData must not supply the log temperature.
        const markEvent = vi.fn();
        const props: Props = { livePoints: rawSeries(120, earlyCrossRawAt, risingEma), markEvent };
        const h = renderAutoDetection(props);

        tick(h, props, 42, 100);
        expect(markEvent).not.toHaveBeenCalled();
        expect(h.result.confirmedTP).toBeNull();

        tick(h, props, 42, 120);
        expect(h.result.confirmedTP?.fallback).toBe(true);
        expect(h.result.confirmedTP?.temp).toBeCloseTo(150.5, 5);
        expect(markEvent).not.toHaveBeenCalled();
        h.render({ ...props, livePoints: rawSeries(121, earlyCrossRawAt, risingEma) });
        expect(markEvent).toHaveBeenCalledWith('Yellow', 'Auto-marked by temperature', undefined, {
            timeSec: 120,
            tempC: 150.5,
        });
    });

    it('does not fire Yellow while raw BT is descending through the threshold (hot-drum charge)', () => {
        const markEvent = vi.fn();
        let props: Props = { livePoints: rawSeries(130, descentRawAt, risingEma), markEvent };
        const h = renderAutoDetection(props);

        tick(h, props, 42, 130);
        expect(h.result.confirmedTP?.fallback).toBe(true);
        expect(h.result.confirmedTP?.temp).toBeCloseTo(descentRawAt(130), 5);

        props = { ...props, livePoints: rawSeries(131, descentRawAt, risingEma) };
        tick(h, props, 210, 131);
        expect(markEvent).not.toHaveBeenCalled();
    });

    it('drops the Yellow latch when raw BT falls back through the threshold', () => {
        const markEvent = vi.fn();
        let props: Props = { livePoints: rawSeries(120, releasedCrossRawAt, risingEma), markEvent };
        const h = renderAutoDetection(props);

        tick(h, props, 42, 120);
        expect(h.result.confirmedTP?.fallback).toBe(true);
        props = { ...props, livePoints: rawSeries(120.5, releasedCrossRawAt, risingEma) };
        tick(h, props, 42, 121);
        expect(markEvent).not.toHaveBeenCalled();

        props = { ...props, livePoints: rawSeries(126, releasedCrossRawAt, risingEma) };
        tick(h, props, 42, 126);
        expect(markEvent).toHaveBeenCalledWith('Yellow', 'Auto-marked by temperature', undefined, {
            timeSec: 125,
            tempC: 150,
        });
    });

    it('prefers a real turning point over the fallback at the timeout boundary', () => {
        const markEvent = vi.fn();
        const points = realTpPoints();
        const props: Props = { livePoints: points, markEvent };
        const h = renderAutoDetection(props);

        tick(h, props, 42, 130); // elapsed past the fallback threshold, real TP available
        expect(h.result.confirmedTP?.fallback).toBeFalsy();
        expect(h.result.confirmedTP?.timeSec).toBeGreaterThan(40);
        expect(h.result.confirmedTP?.timeSec).toBeLessThan(80);
        const atTp = points.find((p) => p.time === h.result.confirmedTP?.timeSec);
        expect(h.result.confirmedTP?.temp).toBe(atTp?.btRaw);
        expect(h.result.confirmedTP?.temp).not.toBe(180);
    });

    it('never auto-marks FC Start by temperature', () => {
        const markEvent = vi.fn();
        let props: Props = { livePoints: rawSeries(120, earlyCrossRawAt, risingEma), markEvent };
        const h = renderAutoDetection(props);

        tick(h, props, 42, 120);
        props = { ...props, livePoints: rawSeries(140, earlyCrossRawAt, risingEma) };
        tick(h, props, 202, 140);

        expect(markEvent).toHaveBeenCalledWith('Yellow', 'Auto-marked by temperature', undefined, {
            timeSec: 120,
            tempC: 150.5,
        });
        expect(markEvent).not.toHaveBeenCalledWith('FC Start', expect.anything());
    });

    it('skips Yellow auto-mark when autoYellowEnabled is false', () => {
        const markEvent = vi.fn();
        let props: Props = {
            livePoints: rawSeries(120, earlyCrossRawAt, risingEma),
            markEvent,
            autoYellowEnabled: false,
        };
        const h = renderAutoDetection(props);

        tick(h, props, 42, 120);
        props = { ...props, livePoints: rawSeries(121, earlyCrossRawAt, risingEma) };
        tick(h, props, 202, 121);

        expect(markEvent).not.toHaveBeenCalled();
    });
});

describe('useAutoDetection — raw BT for TP and Yellow', () => {
    beforeEach(() => {
        void act(() => useRoastingStore.getState().reset());
    });

    it('does not treat a single raw spike as the turning-point minimum', () => {
        const clean = realTpPoints();
        const valley = clean.reduce((best, point) =>
            (point.btRaw ?? Infinity) < (best.btRaw ?? Infinity) ? point : best,
        );
        const spiked = clean.map((point) => (point.time === 65 ? { ...point, btRaw: 60 } : point));
        const props: Props = { livePoints: spiked, markEvent: vi.fn() };
        const h = renderAutoDetection(props);

        tick(h, props, 42, 140);
        expect(h.result.confirmedTP?.fallback).toBeFalsy();
        expect(h.result.confirmedTP?.timeSec).toBe(valley.time);
        expect(h.result.confirmedTP?.temp).toBe(valley.btRaw);
        expect(h.result.confirmedTP?.temp).not.toBe(60);
    });

    it('keeps a valid raw sample when the display EMA at that time is a glitch', () => {
        const points = realTpPoints().map((point) => ({
            ...point,
            bt: point.time % 1 === 0 ? 30 : 390,
        }));
        const props: Props = { livePoints: points, markEvent: vi.fn() };
        const h = renderAutoDetection(props);

        tick(h, props, 30, 140);
        expect(h.result.confirmedTP?.fallback).toBeFalsy();
        expect(h.result.confirmedTP?.temp).toBeGreaterThan(90);
        expect(h.result.confirmedTP?.temp).toBeLessThan(130);
    });

    it('does not substitute display EMA when btRaw is missing', () => {
        const markEvent = vi.fn();
        const withoutRaw = rawSeries(200, realRawAt).map((point) => ({ time: point.time, bt: point.btRaw ?? 0 }));
        const explicitNull = withoutRaw.map((point) => ({ ...point, btRaw: null }));
        for (const livePoints of [withoutRaw, explicitNull]) {
            const props: Props = { livePoints, markEvent };
            const h = renderAutoDetection(props);
            tick(h, props, 180, 200);
            expect(h.result.confirmedTP).toBeNull();
            expect(markEvent).not.toHaveBeenCalled();
            act(() => {
                for (const root of roots.splice(0)) root.unmount();
            });
            act(() => useRoastingStore.getState().reset());
        }
    });
});

describe('useAutoDetection — raw BT slope breaks (#448)', () => {
    const origin = 1_800_000_000_000;
    const sample = (t: number, btRaw: number | null, stale = false) => {
        act(() =>
            useRoastingStore
                .getState()
                .updateRawTemperature(
                    stale || btRaw == null ? null : { bt: btRaw, timestamp: t, receivedAtMs: origin + t * 1000 },
                ),
        );
    };
    const setup = (
        phase: 'standby' | 'roasting' | 'preheating' = 'standby',
        elapsed = 200,
        extra: Partial<Props> = {},
    ) => {
        act(() => useRoastingStore.setState({ phase, elapsed, roastStartMs: origin, sidecarConnected: true }));
        const onAutoCharge = vi.fn();
        const onAutoDrop = vi.fn();
        const props: Props = { livePoints: [], markEvent: noop, onAutoCharge, onAutoDrop, ...extra };
        const h = renderAutoDetection(props);
        return { ...h, onAutoCharge, onAutoDrop, props };
    };
    const fallingDrop = (startT = 0) => {
        for (let i = 0; i <= 16; i++) sample(startT + i, 200 - Math.max(0, i - 10));
    };

    it.each([0.5, 1])('detects slow charge at %ss polling with jitter and raw onset time', (interval) => {
        for (const rate of [1, 2, 3]) {
            const h = setup();
            for (let i = 0; i <= 16; i++) {
                const t = i * interval + (i % 2 ? 0.02 : 0);
                sample(t, 200 - rate * Math.max(0, t - 4 * interval));
            }
            expect(h.onAutoCharge).toHaveBeenCalledTimes(1);
            const [bt, time] = h.onAutoCharge.mock.calls[0];
            expect(bt).toBe(200);
            expect(time).toBeCloseTo(origin + 4 * interval * 1000, 0);
            act(() => {
                for (const root of roots.splice(0)) root.unmount();
            });
            act(() => useRoastingStore.getState().reset());
        }
    });

    it.each([0.5, 1])('rejects steady cooling and isolated spikes at %ss polling', (interval) => {
        const h = setup();
        for (let i = 0; i <= 80; i++) sample(i * interval, 220 - 0.4 * i * interval);
        expect(h.onAutoCharge).not.toHaveBeenCalled();
        act(() => h.result.resetAutoDetection());
        for (let i = 0; i <= 20; i++) sample(100 + i * interval, i === 10 ? 190 : 200);
        expect(h.onAutoCharge).not.toHaveBeenCalled();
    });

    it('detects quantized 1°C readings using the wider comparison', () => {
        const h = setup();
        for (let i = 0; i <= 20; i++) sample(i / 2, 200 - Math.floor(Math.max(0, i / 2 - 4)));
        expect(h.onAutoCharge).toHaveBeenCalledTimes(1);
    });

    it('does not treat duplicate, stale, missing or invalid raw readings as samples', () => {
        const h = setup();
        for (let t = 0; t <= 4; t++) sample(t, 200);
        sample(5, 198);
        for (let i = 0; i < 5; i++) sample(5, 196); // cached sensor timestamp
        expect(h.onAutoCharge).not.toHaveBeenCalled();
        sample(6, 196, true);
        sample(7, 194, true);
        sample(8, null);
        sample(9, Number.NaN);
        sample(10, 0);
        sample(11, 400);
        sample(12, 190);
        sample(13, 188);
        expect(h.onAutoCharge).not.toHaveBeenCalled();
    });

    it('clears history across gaps, clock resets and phase changes', () => {
        const h = setup();
        for (let t = 0; t <= 4; t++) sample(t, 200);
        for (let t = 10; t <= 16; t++) sample(t, 200 - 2 * (t - 10));
        expect(h.onAutoCharge).not.toHaveBeenCalled();
        for (let t = 0; t <= 5; t++) sample(t, 180 - 2 * t);
        expect(h.onAutoCharge).not.toHaveBeenCalled();
        act(() => useRoastingStore.setState({ phase: 'preheating' }));
        for (let t = 6; t <= 12; t++) sample(t, 200);
        act(() => useRoastingStore.setState({ phase: 'standby' }));
        for (let t = 13; t <= 20; t++) sample(t, 200 - 2 * (t - 12));
        expect(h.onAutoCharge).not.toHaveBeenCalled();
    });

    it('preserves manual charge exclusion, reset/rearm, warm-drum and READY gates', () => {
        const h = setup('preheating');
        for (let t = 0; t <= 10; t++) sample(t, 200 - 2 * Math.max(0, t - 4));
        expect(h.onAutoCharge).not.toHaveBeenCalled();
        act(() => useRoastingStore.setState({ phase: 'standby' }));
        for (let t = 11; t <= 21; t++) sample(t, 70 - 2 * Math.max(0, t - 15));
        expect(h.onAutoCharge).not.toHaveBeenCalled();
        act(() => {
            h.result.resetAutoDetection();
            h.result.disableAutoCharge();
        });
        for (let t = 22; t <= 32; t++) sample(t, 200 - 2 * Math.max(0, t - 26));
        expect(h.onAutoCharge).not.toHaveBeenCalled();
        act(() => h.result.rearmAutoCharge());
        for (let t = 33; t <= 43; t++) sample(t, 200 - 2 * Math.max(0, t - 37));
        expect(h.onAutoCharge).toHaveBeenCalledTimes(1);
    });

    it('announces the Drop cool-down once when auto Charge is on', () => {
        const h = setup();
        act(() => h.result.holdAutoChargeUntilRecovery());
        act(() => h.result.holdAutoChargeUntilRecovery());
        expect(useToastStore.getState().toasts.map(({ message, tone }) => ({ message, tone }))).toEqual([
            { message: i18n.t('activeRoast.autoChargeHeld'), tone: 'info' },
        ]);

        const off = renderAutoDetection({
            livePoints: [],
            markEvent: noop,
            autoChargeEnabled: false,
        });
        act(() => off.result.holdAutoChargeUntilRecovery());
        expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('ignores Drop cool-down and rearms after BT recovers for the next batch', () => {
        const h = setup();
        act(() => h.result.holdAutoChargeUntilRecovery());
        for (const [i, bt] of [200, 198, 196, 193, 190, 188, 187, 186, 188, 186, 187, 188].entries()) {
            sample(i * 0.5, bt);
        }
        expect(h.onAutoCharge).not.toHaveBeenCalled();
        sample(6, 189);
        for (let i = 13; i <= 25; i++) sample(i * 0.5, 189 - Math.max(0, i - 19));
        expect(h.onAutoCharge).toHaveBeenCalledTimes(1);
    });

    it('consumes batched identical readings and survives changing callback identities', () => {
        act(() => useRoastingStore.setState({ phase: 'standby', sidecarConnected: true }));
        const callback = vi.fn();
        const props: Props = { livePoints: [], markEvent: noop, onAutoCharge: callback };
        const h = renderAutoDetection(props);
        act(() => {
            for (let i = 0; i < 5; i++) sample(i / 2, 200);
        });
        h.render({ ...props, onAutoCharge: (bt, time) => callback(bt, time) });
        sample(2.5, 199);
        h.render({ ...props, onAutoCharge: (bt, time) => callback(bt, time) });
        sample(3, 198);
        sample(3.5, 197);
        sample(4, 196);
        expect(callback).toHaveBeenCalledExactlyOnceWith(200, origin + 2000);
    });

    it('resets on settings changes, preserves the fired latch and permits a new batch', () => {
        act(() => useRoastingStore.setState({ phase: 'standby', sidecarConnected: true }));
        const onAutoCharge = vi.fn();
        const props: Props = { livePoints: [], markEvent: noop, onAutoCharge };
        const h = renderAutoDetection({ ...props, autoChargeEnabled: false });
        for (let i = 0; i < 10; i++) sample(i / 2, 200 - Math.max(0, i - 4));
        expect(onAutoCharge).not.toHaveBeenCalled();
        h.render(props);
        sample(5, 194);
        sample(5.5, 193);
        expect(onAutoCharge).not.toHaveBeenCalled();
        for (let i = 0; i < 5; i++) sample(10 + i / 2, 200);
        sample(12.5, 199);
        h.render({ ...props, autoChargeMode: 'sensitive' });
        sample(13, 198);
        expect(onAutoCharge).not.toHaveBeenCalled();
        for (let i = 0; i < 10; i++) sample(20 + i / 2, 200 - Math.max(0, i - 4));
        expect(onAutoCharge).toHaveBeenCalledTimes(1);
        h.render({ ...props, autoChargeEnabled: false });
        h.render(props);
        for (let i = 0; i < 10; i++) sample(30 + i / 2, 200 - Math.max(0, i - 4));
        expect(onAutoCharge).toHaveBeenCalledTimes(1);
        act(() => h.result.resetAutoDetection());
        for (let i = 0; i < 10; i++) sample(40 + i / 2, 200 - Math.max(0, i - 4));
        expect(onAutoCharge).toHaveBeenCalledTimes(2);
    });

    it.each(['connection', 'reconnecting', 'machine', 'raw-null', 'period'] as const)(
        'clears pending onset on %s change',
        (change) => {
            act(() => useRoastingStore.setState({ phase: 'standby', sidecarConnected: true }));
            const onAutoCharge = vi.fn();
            const props: Props = { livePoints: [], markEvent: noop, onAutoCharge };
            const h = renderAutoDetection(props);
            for (let i = 0; i < 5; i++) sample(i / 2, 200);
            sample(2.5, 199);
            act(() => {
                if (change === 'connection') {
                    useRoastingStore.getState().setConnected(false);
                    useRoastingStore.getState().setConnected(true);
                }
                if (change === 'reconnecting') {
                    useRoastingStore.getState().setReconnecting(true);
                    useRoastingStore.getState().setReconnecting(false);
                }
                if (change === 'machine')
                    useRoastingStore.setState({ machineSnapshot: { machine_id: 'new' } as never });
                if (change === 'raw-null') useRoastingStore.getState().updateRawTemperature(null);
            });
            if (change === 'period') h.render({ ...props, pollIntervalMs: 1000 });
            sample(3, 198);
            expect(onAutoCharge).not.toHaveBeenCalled();
        },
    );

    it('detects raw BT drop after 7 min and marks the bend, not display EMA', () => {
        const h = setup('roasting', 430);
        for (let i = 0; i <= 16; i++) sample(i, 200 - Math.max(0, i - 10));
        expect(h.onAutoDrop).toHaveBeenCalledTimes(1);
        expect(h.onAutoDrop.mock.calls[0][0]).toEqual({ timeSec: 10, bt: 200 });
        expect(h.onAutoCharge).not.toHaveBeenCalled();
    });

    it('does not drop before 7 min, below 160 C, or from display-only BT', () => {
        const early = setup('roasting', 170);
        for (let i = 0; i <= 16; i++) sample(i, 200 - Math.max(0, i - 10));
        expect(early.onAutoDrop).not.toHaveBeenCalled();
        act(() => {
            for (const root of roots.splice(0)) root.unmount();
        });
        act(() => useRoastingStore.getState().reset());
        const cool = setup('roasting', 430);
        for (let i = 0; i <= 16; i++) sample(i, 90 - Math.max(0, i - 10));
        expect(cool.onAutoDrop).not.toHaveBeenCalled();
        act(() => {
            for (const root of roots.splice(0)) root.unmount();
        });
        act(() => useRoastingStore.getState().reset());
        const display = setup('roasting', 430);
        act(() =>
            useRoastingStore.getState().updateLiveData({
                bt: 180,
                bt_raw: 100,
                timestamp: 12,
                receivedAtMs: origin + 12_000,
                et: null,
                ror: 0,
                ror_et: 0,
                heater: 0,
                fan: 0,
                drum: 0,
            }),
        );
        expect(display.onAutoDrop).not.toHaveBeenCalled();
    });

    it('rejects steady cooling and does not charge during roasting', () => {
        const h = setup('roasting', 430);
        for (let i = 0; i <= 80; i++) sample(i, 220 - 0.4 * i);
        expect(h.onAutoDrop).not.toHaveBeenCalled();
        expect(h.onAutoCharge).not.toHaveBeenCalled();
    });

    it('blocks auto Drop after a manual mark', () => {
        const h = setup('roasting', 430);
        act(() => h.result.disableAutoDrop());
        for (let i = 0; i <= 16; i++) sample(i, 200 - Math.max(0, i - 10));
        expect(h.onAutoDrop).not.toHaveBeenCalled();
    });

    it.each([
        [7 * 60 - 1, false],
        [7 * 60, false],
        [7 * 60 + 1, true],
    ] as const)('default 7 min gate: elapsed %ss fires=%s (exact minute does not)', (elapsed, fires) => {
        const h = setup('roasting', elapsed);
        fallingDrop();
        expect(h.onAutoDrop).toHaveBeenCalledTimes(fires ? 1 : 0);
    });

    it.each([
        [3 * 60 - 1, false],
        [3 * 60, false],
        [3 * 60 + 1, true],
        [5 * 60, true],
    ] as const)('start=3 min: elapsed %ss fires=%s', (elapsed, fires) => {
        const h = setup('roasting', elapsed, { autoDropStartMin: 3 });
        fallingDrop();
        expect(h.onAutoDrop).toHaveBeenCalledTimes(fires ? 1 : 0);
    });

    it.each([
        ['standard', 500],
        ['standard', 1000],
        ['sensitive', 500],
        ['sensitive', 1000],
    ] as const)('detects a ~5 min drop at %s / %ims when start is 3 min', (autoDropMode, pollIntervalMs) => {
        const h = setup('roasting', 5 * 60, { autoDropStartMin: 3, autoDropMode, pollIntervalMs });
        fallingDrop();
        expect(h.onAutoDrop).toHaveBeenCalledTimes(1);
        expect(h.onAutoDrop.mock.calls[0][0].bt).toBeGreaterThan(160);
    });

    it('does not fire a pre-gate candidate when the gate opens', () => {
        // 1000ms detector: samples 0–5 leave a pending onset; sample 6 would confirm it.
        const h = setup('roasting', 7 * 60, { pollIntervalMs: 1000 });
        for (const [i, bt] of [200, 200, 200, 199, 198, 197].entries()) sample(i, bt);
        expect(h.onAutoDrop).not.toHaveBeenCalled();
        act(() => useRoastingStore.setState({ elapsed: 7 * 60 + 1 }));
        sample(6, 196);
        expect(h.onAutoDrop).not.toHaveBeenCalled();
        fallingDrop(20);
        expect(h.onAutoDrop).toHaveBeenCalledTimes(1);
    });

    it('does not replay a pre-gate drop after the start minute is lowered', () => {
        const h = setup('roasting', 5 * 60, { autoDropStartMin: 7 });
        fallingDrop();
        expect(h.onAutoDrop).not.toHaveBeenCalled();
        h.render({ ...h.props, autoDropStartMin: 3 });
        sample(17, 193);
        expect(h.onAutoDrop).not.toHaveBeenCalled();
        fallingDrop(40);
        expect(h.onAutoDrop).toHaveBeenCalledTimes(1);
    });

    it('drops a pending candidate when the start minute changes while the gate is already open', () => {
        const h = setup('roasting', 400, { autoDropStartMin: 3, pollIntervalMs: 1000 });
        for (const [i, bt] of [200, 200, 200, 199, 198, 197].entries()) sample(i, bt);
        h.render({ ...h.props, autoDropStartMin: 4 });
        sample(6, 196);
        expect(h.onAutoDrop).not.toHaveBeenCalled();
    });

    it('does not duplicate Drop across toggle, disconnect, or the next batch until reset', () => {
        const h = setup('roasting', 5 * 60, { autoDropStartMin: 3 });
        fallingDrop();
        expect(h.onAutoDrop).toHaveBeenCalledTimes(1);
        h.render({ ...h.props, autoDropEnabled: false });
        h.render(h.props);
        fallingDrop(40);
        expect(h.onAutoDrop).toHaveBeenCalledTimes(1);
        act(() => {
            useRoastingStore.getState().setConnected(false);
            useRoastingStore.getState().setConnected(true);
        });
        fallingDrop(80);
        expect(h.onAutoDrop).toHaveBeenCalledTimes(1);
        act(() => h.result.resetAutoDetection());
        fallingDrop(120);
        expect(h.onAutoDrop).toHaveBeenCalledTimes(2);
    });

    it('blocks auto Drop when a manual Drop is already in the log', () => {
        const h = setup('roasting', 5 * 60, {
            autoDropStartMin: 3,
            logEntries: [{ time: '5:00', event: 'Drop', temp: '200', note: '' }],
        });
        fallingDrop();
        expect(h.onAutoDrop).not.toHaveBeenCalled();
    });
});

describe('raw BT observation regressions', () => {
    it.each(['disconnected', 'reconnecting'])('holds TP and Yellow while %s', (status) => {
        const markEvent = vi.fn();
        const props: Props = { livePoints: rawSeries(130, earlyCrossRawAt), markEvent };
        const h = renderAutoDetection(props);
        act(() =>
            useRoastingStore.setState({
                phase: 'roasting',
                elapsed: 130,
                sidecarConnected: status !== 'disconnected',
                reconnecting: status === 'reconnecting',
            }),
        );
        h.render(props);
        expect(h.result.confirmedTP).toBeNull();
        expect(markEvent).not.toHaveBeenCalled();
    });

    const run = (rawAt: (t: number) => number | null, until: number) => {
        const onTurningPoint = vi.fn();
        const markEvent = vi.fn();
        const props: Props = { livePoints: [], markEvent, onTurningPoint };
        const h = renderAutoDetection(props);
        for (let t = 0; t <= until; t += 0.5) {
            props.livePoints = [...props.livePoints, { time: t, bt: 180, btRaw: rawAt(t) }];
            tick(h, props, 180, t);
        }
        return { h, props, markEvent, onTurningPoint };
    };

    it('confirms a noisy raw valley before fallback and does not lock the early rebound', () => {
        const { h, onTurningPoint } = run(
            (t) =>
                t <= 20
                    ? 180 - 2.5 * t
                    : t <= 24
                      ? 130 + 0.1 * (t - 20)
                      : t <= 60
                        ? 130.4 - (30.4 / 36) * (t - 24)
                        : 100 + 0.1 * (t - 60) + (Math.round(t * 2) % 2 ? 0.2 : -0.2),
            100,
        );
        expect(h.result.confirmedTP?.fallback).toBeFalsy();
        expect(h.result.confirmedTP?.timeSec).toBeGreaterThanOrEqual(60);
        expect(h.result.confirmedTP?.timeSec).toBeLessThanOrEqual(62);
        expect(onTurningPoint).toHaveBeenCalledTimes(1);
    });

    it('waits for sustained Yellow crossing and records the original raw crossing', () => {
        const { markEvent } = run(
            (t) =>
                t <= 30
                    ? 180 - 2 * t
                    : t <= 59
                      ? 120 + (29.4 / 29) * (t - 30)
                      : t === 60
                        ? 150.1
                        : t < 100
                          ? 149.4
                          : 150 + (t - 100) * 0.3,
            110,
        );
        expect(markEvent).toHaveBeenCalledTimes(1);
        expect(markEvent.mock.calls[0][3]).toEqual({ timeSec: 100, tempC: 150 });
    });

    it('does not bridge missing raw data or reuse it for the timeout fallback', () => {
        const { h } = run((t) => (t <= 20 ? 180 - t : null), 120);
        expect(h.result.confirmedTP).toBeNull();
    });

    it('does not generate fallback while only an old raw observation remains', () => {
        const props: Props = { livePoints: rawSeries(20, (t) => 180 - t), markEvent: vi.fn() };
        const h = renderAutoDetection(props);
        tick(h, props, 180, 120);
        expect(h.result.confirmedTP).toBeNull();
    });

    it('does not count repeated sensor timestamps as TP/Yellow evidence', () => {
        const points = rawSeries(130, realRawAt).map((point) => ({
            ...point,
            sensorTimestamp: 1,
            sensorClock: 'probe:1',
        }));
        const props: Props = { livePoints: points, markEvent: vi.fn() };
        const h = renderAutoDetection(props);
        tick(h, props, 180, 130);
        expect(h.result.confirmedTP).toBeNull();
        expect(props.markEvent).not.toHaveBeenCalled();
    });
});
