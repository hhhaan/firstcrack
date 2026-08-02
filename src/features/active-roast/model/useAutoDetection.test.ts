// @vitest-environment jsdom
import type { LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastingStore } from './status';
import { useAutoDetection } from './useAutoDetection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = {
    livePoints: { time: number; bt: number }[];
    markEvent: (event: string, note: string) => void;
    logEntries?: LogEntry[];
    autoYellowEnabled?: boolean;
    autoFcStartEnabled?: boolean;
    onTurningPoint?: (tp: { timeSec: number; temp: number; fallback?: boolean }) => void;
};

const noop = () => {};

/** Render the real hook and expose its return value + a way to push new props. */
const renderAutoDetection = (initial: Props) => {
    const root = createRoot(document.createElement('div'));
    let latest: ReturnType<typeof useAutoDetection>;

    const Probe = (p: Props) => {
        latest = useAutoDetection({
            livePoints: p.livePoints,
            onAutoCharge: noop,
            onAutoDrop: noop,
            onTurningPoint: p.onTurningPoint ?? noop,
            autoChargeDropC: 5,
            autoDropDropC: 8,
            yellowTempC: 150,
            fcStartTempC: 200,
            unit: 'C',
            markEvent: p.markEvent,
            logEntries: p.logEntries ?? [],
            autoYellowEnabled: p.autoYellowEnabled ?? true,
            autoFcStartEnabled: p.autoFcStartEnabled ?? true,
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

describe('useAutoDetection — Yellow/FC gating', () => {
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

    it('does not fire Yellow/FC while BT is descending above the thresholds (hot-drum charge)', () => {
        const markEvent = vi.fn();
        const props: Props = { livePoints: shallowHotDrumPoints(), markEvent };
        const h = renderAutoDetection(props);

        for (const [i, bt] of [210, 205, 200, 195, 190].entries()) tick(h, props, bt, 100 + i);
        tick(h, props, 185, 130); // fallback opens the gate with BT still above both thresholds
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

    it('skips Yellow auto-mark when autoYellowEnabled is false but still fires FC', () => {
        const markEvent = vi.fn();
        const props: Props = {
            livePoints: shallowHotDrumPoints(),
            markEvent,
            autoYellowEnabled: false,
            autoFcStartEnabled: true,
        };
        const h = renderAutoDetection(props);

        tick(h, props, 148, 60);
        tick(h, props, 152, 61); // Yellow threshold cross, gate closed
        tick(h, props, 198, 120);
        tick(h, props, 202, 121); // FC threshold cross, gate still closed
        tick(h, props, 205, 130); // TP fallback opens gate
        tick(h, props, 208, 131);

        expect(markEvent).not.toHaveBeenCalledWith('Yellow', expect.anything());
        expect(markEvent).toHaveBeenCalledWith('FC Start', 'Auto-marked by temperature');
    });

    it('skips FC auto-mark when autoFcStartEnabled is false but still fires Yellow', () => {
        const markEvent = vi.fn();
        const props: Props = {
            livePoints: shallowHotDrumPoints(),
            markEvent,
            autoYellowEnabled: true,
            autoFcStartEnabled: false,
        };
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

    it('skips both Yellow and FC auto-mark when both toggles are off', () => {
        const markEvent = vi.fn();
        const props: Props = {
            livePoints: shallowHotDrumPoints(),
            markEvent,
            autoYellowEnabled: false,
            autoFcStartEnabled: false,
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
