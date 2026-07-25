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
};

const noop = () => {};

/** Render the real hook and expose its return value + a way to push new props. */
const renderAutoDetection = (initial: Props) => {
    const root = createRoot(document.createElement('div'));
    let latest: ReturnType<typeof useAutoDetection>;

    const Probe = (p: Props) => {
        latest = useAutoDetection(p.livePoints, noop, noop, noop, 5, 150, 200, 'C', p.markEvent, p.logEntries ?? []);
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
});
