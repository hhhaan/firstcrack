import { type BbpPoint, hydrateLiveBbp, useBbpStore } from '@features/active-roast/model/bbp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    bbpTimeOriginKey,
    noteChartOnlyPreheatMount,
    resetChartOnlyPreheatMountsForTests,
    shouldResetChartOnlyPreheatOnPageRestore,
    shouldStartChartOnlyPreheat,
} from './bbp-preheat';
import { resolveLiveChartView } from './live-chart-view';

const sample = (bt: number) => ({ bt, et: 200, heater: 50, fan: 40, drum: 60 });
const BOOT = 1_000_000;

const chartOf = (points: BbpPoint[]) =>
    resolveLiveChartView({
        bbpActive: true,
        charged: false,
        livePoints: [],
        bbpPoints: points,
        roastTarget: [],
        bbpTarget: [],
        bbpTargetError: false,
        bbpWindowSeconds: 1200,
    });

describe('first-batch preheat display', () => {
    beforeEach(() => {
        resetChartOnlyPreheatMountsForTests();
        useBbpStore.setState({
            active: false,
            recording: false,
            startMs: 0,
            points: [],
            finalized: null,
            finalizedPoints: [],
        });
    });

    it('uses a preheat title until End→Charge recording starts', () => {
        expect(bbpTimeOriginKey(false)).toBe('bbp.preheatTimeOrigin');
        expect(bbpTimeOriginKey(true)).toBe('bbp.timeOrigin');
    });

    it('reload during preheat does not restore the curve', () => {
        const mem: Record<string, string> = {};
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => mem[k] ?? null,
            setItem: (k: string, v: string) => {
                mem[k] = v;
            },
            removeItem: (k: string) => {
                delete mem[k];
            },
        });
        try {
            const previousStart = BOOT - 210_000;
            useBbpStore.getState().begin(previousStart, [], false);
            useBbpStore.getState().append(sample(200), previousStart);
            useBbpStore.getState().append(sample(210), previousStart + 210_000);
            const stale = useBbpStore.getState();
            expect(mem.fc_bbp_live).toBeUndefined();
            expect(chartOf(stale.points).bbpRange?.end).toBeGreaterThan(200);

            // New document: nothing was persisted, so hydrate cannot continue the curve.
            useBbpStore.setState({ active: false, recording: false, startMs: 0, points: [] });
            expect(hydrateLiveBbp()).toBe(false);
            expect(shouldStartChartOnlyPreheat(useBbpStore.getState(), BOOT)).toBe(true);
            useBbpStore.getState().begin(BOOT, [], false);
            const restarted = useBbpStore.getState();
            expect(restarted).toMatchObject({ active: true, recording: false, startMs: BOOT, points: [] });
            expect(chartOf(restarted.points).bbpRange).toBeUndefined();
            expect(chartOf(restarted.points).livePoints).toEqual([]);
            expect(mem.fc_bbp_live).toBeUndefined();

            // Same document keeps the new preheat. A surviving store from before boot does not.
            useBbpStore.getState().append(sample(201), BOOT + 2_000);
            expect(shouldStartChartOnlyPreheat(useBbpStore.getState(), BOOT)).toBe(false);
            useBbpStore.setState({ active: true, recording: false, startMs: BOOT - 210_000 });
            expect(shouldStartChartOnlyPreheat(useBbpStore.getState(), BOOT)).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('does not wipe a persisted Charge wait on reload', () => {
        const mem: Record<string, string> = {};
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => mem[k] ?? null,
            setItem: (k: string, v: string) => {
                mem[k] = v;
            },
            removeItem: (k: string) => {
                delete mem[k];
            },
        });
        try {
            useBbpStore.getState().begin(BOOT - 210_000, [
                { t: 0, ...sample(180) },
                { t: 210, ...sample(190) },
            ]);
            useBbpStore.setState({ active: false, recording: false, startMs: 0, points: [] });
            expect(hydrateLiveBbp()).toBe(true);
            const restored = useBbpStore.getState();
            expect(restored.recording).toBe(true);
            expect(restored.points[restored.points.length - 1]?.t).toBe(210);
            expect(shouldStartChartOnlyPreheat(restored, BOOT)).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('a new Active Roast mount restarts chart-only preheat from this document', () => {
        noteChartOnlyPreheatMount(1);
        useBbpStore.setState({
            active: true,
            recording: false,
            startMs: BOOT + 5_000,
            points: [
                { t: 0, ...sample(200) },
                { t: 95, ...sample(210) },
            ],
        });
        const live = useBbpStore.getState();
        expect(shouldStartChartOnlyPreheat(live, BOOT, 1)).toBe(false);
        expect(shouldStartChartOnlyPreheat(live, BOOT, 2)).toBe(true);
        expect(shouldStartChartOnlyPreheat({ ...live, recording: true }, BOOT, 2)).toBe(false);
    });

    it('bfcache restores chart-only preheat from zero and leaves Charge wait recorded', () => {
        expect(shouldResetChartOnlyPreheatOnPageRestore(true, { recording: false }, 'preheating', false)).toBe(true);
        expect(shouldResetChartOnlyPreheatOnPageRestore(true, { recording: true }, 'standby', true)).toBe(false);
        expect(shouldResetChartOnlyPreheatOnPageRestore(false, { recording: false }, 'preheating', false)).toBe(false);
        expect(
            shouldResetChartOnlyPreheatOnPageRestore(false, { recording: false }, 'preheating', false, 'reload'),
        ).toBe(true);
        expect(shouldResetChartOnlyPreheatOnPageRestore(false, { recording: true }, 'standby', true, 'reload')).toBe(
            false,
        );
    });
});
