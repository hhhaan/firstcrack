import { type BbpPoint, hydrateLiveBbp, useBbpStore } from '@features/active-roast/model/bbp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    chartOnlyPreheatDecision,
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
        const local: Record<string, string> = {};
        const session: Record<string, string> = {};
        const api = (mem: Record<string, string>) => ({
            getItem: (k: string) => mem[k] ?? null,
            setItem: (k: string, v: string) => {
                mem[k] = v;
            },
            removeItem: (k: string) => {
                delete mem[k];
            },
        });
        vi.stubGlobal('localStorage', api(local));
        vi.stubGlobal('sessionStorage', api(session));
        try {
            useBbpStore.getState().begin(BOOT - 210_000, [
                { t: 0, ...sample(180) },
                { t: 210, ...sample(190) },
            ]);
            useBbpStore.setState({ active: false, recording: false, liveGeneration: '', startMs: 0, points: [] });
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

    const preheatInput = (
        over: Partial<Parameters<typeof chartOnlyPreheatDecision>[0]> = {},
    ): Parameters<typeof chartOnlyPreheatDecision>[0] => ({
        visible: true,
        bbp: useBbpStore.getState(),
        bootMs: BOOT,
        mountEpoch: 1,
        phase: 'preheating',
        awaitingNextCharge: false,
        bbpEnabled: true,
        ...over,
    });

    const applyDecision = (decision: ReturnType<typeof chartOnlyPreheatDecision>, now: number) => {
        if (decision === 'begin') useBbpStore.getState().begin(now, [], false);
    };

    it.each(['preheating', 'standby'])('keeps collecting chart-only %s across sidebar navigation', (phase) => {
        noteChartOnlyPreheatMount(1);
        const started = BOOT + 5_000;
        useBbpStore.getState().begin(started, [], false);
        useBbpStore.getState().append(sample(200), started);
        useBbpStore.getState().append(sample(210), started + 95_000);
        const live = useBbpStore.getState();
        expect(live.points[live.points.length - 1]?.t).toBeGreaterThan(90);
        // Same mount epoch is what navigation actually is: Active Roast stays mounted.
        expect(shouldStartChartOnlyPreheat(live, BOOT, 1)).toBe(false);
        expect(chartOnlyPreheatDecision(preheatInput({ phase, bbp: live }))).toBe('keep');

        const hidden = chartOnlyPreheatDecision(preheatInput({ visible: false, phase, bbp: live }));
        expect(hidden).toBe('keep');
        applyDecision(hidden, started + 100_000);
        useBbpStore.getState().append(sample(215), started + 110_000);

        const shown = chartOnlyPreheatDecision(preheatInput({ phase, bbp: useBbpStore.getState() }));
        expect(shown).toBe('keep');
        applyDecision(shown, started + 120_000);
        const continued = useBbpStore.getState();
        expect(continued).toMatchObject({ active: true, recording: false, startMs: started });
        expect(continued.points.slice(0, live.points.length)).toEqual(live.points);
        expect(continued.points).toHaveLength(live.points.length + 1);
        expect(chartOf(continued.points).bbpRange?.end).toBe(110);
    });

    it('full reload restarts a surviving chart-only session on the same mount', () => {
        noteChartOnlyPreheatMount(1);
        useBbpStore.setState({
            active: true,
            recording: false,
            startMs: BOOT + 5_000,
            points: [
                { t: 0, ...sample(200) },
                { t: 115, ...sample(210) },
            ],
        });
        const live = useBbpStore.getState();
        expect(shouldStartChartOnlyPreheat(live, BOOT, 1)).toBe(false);
        expect(chartOf(live.points).bbpRange?.end).toBe(115);

        const first = chartOnlyPreheatDecision(
            preheatInput({
                bbp: live,
                navigationType: 'reload',
                reloadConsumed: false,
            }),
        );
        expect(first).toBe('begin');
        applyDecision(first, BOOT + 140_000);
        expect(useBbpStore.getState()).toMatchObject({
            active: true,
            recording: false,
            startMs: BOOT + 140_000,
            points: [],
        });

        noteChartOnlyPreheatMount(1);
        const again = chartOnlyPreheatDecision(
            preheatInput({
                bbp: useBbpStore.getState(),
                navigationType: 'reload',
                reloadConsumed: true,
            }),
        );
        expect(again).toBe('keep');
    });

    it('hide, show, and reload keep a recorded Charge wait', () => {
        const local: Record<string, string> = {};
        const session: Record<string, string> = {};
        const api = (mem: Record<string, string>) => ({
            getItem: (k: string) => mem[k] ?? null,
            setItem: (k: string, v: string) => {
                mem[k] = v;
            },
            removeItem: (k: string) => {
                delete mem[k];
            },
        });
        vi.stubGlobal('localStorage', api(local));
        vi.stubGlobal('sessionStorage', api(session));
        try {
            useBbpStore.getState().begin(BOOT, [
                { t: 0, ...sample(180) },
                { t: 48, ...sample(190) },
            ]);
            const live = useBbpStore.getState();
            expect(live.recording).toBe(true);
            for (const input of [
                preheatInput({ visible: false, bbp: live, awaitingNextCharge: true }),
                preheatInput({ bbp: live, awaitingNextCharge: true }),
                preheatInput({ bbp: live, navigationType: 'reload', awaitingNextCharge: true }),
            ]) {
                expect(chartOnlyPreheatDecision(input)).toBe('keep');
            }
            applyDecision('keep', BOOT + 10_000);
            expect(useBbpStore.getState().points[1]?.t).toBe(48);
            expect(useBbpStore.getState().startMs).toBe(BOOT);
            expect(local.fc_bbp_live).toBeTruthy();
            expect(session.fc_bbp_live_gen).toBeTruthy();
        } finally {
            vi.unstubAllGlobals();
        }
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
