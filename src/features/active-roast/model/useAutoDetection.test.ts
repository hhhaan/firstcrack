// @vitest-environment jsdom
import type { LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { useAutoDetection } from './useAutoDetection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = {
    livePoints: { time: number; bt: number }[];
    markEvent: (event: string, note: string) => void;
    logEntries?: LogEntry[];
    autoYellowEnabled?: boolean;
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
            autoChargeMinRateCPerSec: 0.67,
            autoDropDropC: 8,
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
            ...(elapsed != null ? { elapsed } : {}),
            liveData: { bt, et: null, ror: 0, ror_et: 0, heater: 0, fan: 0, drum: 0 },
        });
    });
    h.render(props);
};

/** Hot-drum series whose global minimum stays above the 150°C TP sanity ceiling → TP rejected. */
const shallowHotDrumPoints = () => {
    const pts: { time: number; bt: number }[] = [];
    for (let t = 0; t <= 60; t += 0.5) pts.push({ time: t, bt: 160 + 50 * Math.exp(-t / 15) });
    return pts;
};

/** Classic curve with a real TP valley near 60s, well inside the sanity range. */
const realTpPoints = () => {
    const pts: { time: number; bt: number }[] = [];
    for (let t = 0; t <= 200; t += 0.5) pts.push({ time: t, bt: 90 + 95 * Math.exp(-t / 20) + 0.18 * t });
    return pts;
};

/** Slow profile whose valley lands at ≈126.5s — after the 120s fallback timeout. */
const lateTpPoints = (until: number) => {
    const pts: { time: number; bt: number }[] = [];
    for (let t = 0; t <= until; t += 0.5) pts.push({ time: t, bt: 90 + 95 * Math.exp(-t / 40) + 0.1 * t });
    return pts;
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

        tick(h, props, 106.7, 120);
        expect(h.result.confirmedTP?.fallback).toBe(true);
        expect(h.result.confirmedTP?.timeSec).toBe(120);
        expect(onTurningPoint).toHaveBeenCalledTimes(1);

        // 폴링이 골짜기를 지나 상승 구간까지 진행 → 실감지가 폴백을 교체하고 한 번 더 발화
        props = { ...props, livePoints: lateTpPoints(140) };
        tick(h, props, 108, 140);
        expect(h.result.confirmedTP?.fallback).toBeFalsy();
        expect(h.result.confirmedTP?.timeSec).toBeCloseTo(126.5, 1);
        expect(onTurningPoint).toHaveBeenCalledTimes(2);
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
        // TP is never detected (valley above the sanity ceiling), so the 120s fallback opens the gate.
        // BT crosses 150 while the gate is still closed — that crossing must not be lost.
        const markEvent = vi.fn();
        const props: Props = { livePoints: shallowHotDrumPoints(), markEvent };
        const h = renderAutoDetection(props);

        tick(h, props, 148, 60);
        tick(h, props, 152, 61); // upward crossing of 150, gate still closed
        expect(markEvent).not.toHaveBeenCalled();
        expect(h.result.confirmedTP).toBeNull();

        tick(h, props, 155, 130); // fallback confirms TP → gate opens
        expect(h.result.confirmedTP?.fallback).toBe(true);

        tick(h, props, 158, 131); // next poll tick fires the pending Yellow
        expect(markEvent).toHaveBeenCalledWith('Yellow', 'Auto-marked by temperature');
    });

    it('does not fire Yellow while BT is descending above the threshold (hot-drum charge)', () => {
        const markEvent = vi.fn();
        const props: Props = { livePoints: shallowHotDrumPoints(), markEvent };
        const h = renderAutoDetection(props);

        for (const [i, bt] of [210, 205, 200, 195, 190].entries()) tick(h, props, bt, 100 + i);
        tick(h, props, 185, 130); // fallback opens the gate with BT still above threshold
        expect(h.result.confirmedTP?.fallback).toBe(true);

        for (const [i, bt] of [180, 175, 170, 165, 160].entries()) tick(h, props, bt, 131 + i);
        expect(markEvent).not.toHaveBeenCalled();
    });

    it('prefers a real turning point over the fallback at the timeout boundary', () => {
        const markEvent = vi.fn();
        const props: Props = { livePoints: realTpPoints(), markEvent };
        const h = renderAutoDetection(props);

        tick(h, props, 130, 130); // elapsed past the fallback threshold, real TP available
        expect(h.result.confirmedTP?.fallback).toBeFalsy();
        expect(h.result.confirmedTP?.timeSec).toBeGreaterThan(40);
        expect(h.result.confirmedTP?.timeSec).toBeLessThan(80);
    });

    it('never auto-marks FC Start by temperature', () => {
        const markEvent = vi.fn();
        const props: Props = { livePoints: shallowHotDrumPoints(), markEvent };
        const h = renderAutoDetection(props);

        tick(h, props, 148, 60);
        tick(h, props, 152, 61);
        tick(h, props, 198, 120);
        tick(h, props, 202, 121);
        tick(h, props, 205, 130);
        tick(h, props, 208, 131);

        expect(markEvent).toHaveBeenCalledWith('Yellow', 'Auto-marked by temperature');
        expect(markEvent).not.toHaveBeenCalledWith('FC Start', expect.anything());
    });

    it('skips Yellow auto-mark when autoYellowEnabled is false', () => {
        const markEvent = vi.fn();
        const props: Props = {
            livePoints: shallowHotDrumPoints(),
            markEvent,
            autoYellowEnabled: false,
        };
        const h = renderAutoDetection(props);

        tick(h, props, 148, 60);
        tick(h, props, 152, 61);
        tick(h, props, 198, 120);
        tick(h, props, 202, 121);
        tick(h, props, 205, 130);
        tick(h, props, 208, 131);

        expect(markEvent).not.toHaveBeenCalled();
    });
});

describe('useAutoDetection — raw BT slope breaks (#448)', () => {
    const origin = 1_800_000_000_000;
    const sample = (t: number, btRaw: number | null, stale = false) => {
        act(() =>
            useRoastingStore.getState().updateLiveData({
                // Display EMA deliberately does not move: raw samples must survive dedupe.
                bt: 200,
                et: null,
                ror: 0,
                ror_et: 0,
                heater: 0,
                fan: 0,
                drum: 0,
                bt_raw: btRaw,
                timestamp: t,
                receivedAtMs: origin + t * 1000,
                stale,
            }),
        );
    };
    const setup = (phase: 'standby' | 'roasting' | 'preheating' = 'standby', elapsed = 200) => {
        act(() => useRoastingStore.setState({ phase, elapsed, roastStartMs: origin }));
        const onAutoCharge = vi.fn();
        const onAutoDrop = vi.fn();
        const h = renderAutoDetection({ livePoints: [], markEvent: noop, onAutoCharge, onAutoDrop });
        return { ...h, onAutoCharge, onAutoDrop };
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

    it('preserves the legacy display-BT Drop threshold and 180s gate', () => {
        vi.useFakeTimers();
        const h = setup('roasting', 170);
        const displaySample = (t: number, bt: number) => {
            vi.setSystemTime(origin + t * 1000);
            act(() =>
                useRoastingStore.getState().updateLiveData({
                    bt,
                    bt_raw: 100,
                    timestamp: t,
                    receivedAtMs: Date.now(),
                    et: null,
                    ror: 0,
                    ror_et: 0,
                    heater: 0,
                    fan: 0,
                    drum: 0,
                }),
            );
        };
        for (let i = 0; i < 5; i++) displaySample(170 + i, 200 - i * 6);
        expect(h.onAutoDrop).not.toHaveBeenCalled();
        act(() => useRoastingStore.setState({ elapsed: 200 }));
        act(() => h.result.resetAutoDetection());
        // Raw/display divergence must not make Drop use the Charge detector.
        for (let i = 0; i < 5; i++) displaySample(200 + i, 200 - i * 0.5);
        expect(h.onAutoDrop).not.toHaveBeenCalled();
        displaySample(205, 192);
        displaySample(206, 186);
        displaySample(207, 180);
        expect(h.onAutoDrop).toHaveBeenCalledTimes(1);
        expect(h.onAutoCharge).not.toHaveBeenCalled();
    });
});
