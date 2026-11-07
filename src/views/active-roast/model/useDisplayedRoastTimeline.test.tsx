// @vitest-environment jsdom
import { useBbpStore } from '@features/active-roast/model/bbp';
import { getRoastSettings } from '@features/active-roast/model/settings';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { TsvPoint } from '@shared/lib/tsv';
import type { LiveRoastPoint, LogEntry } from '@shared/types/roast';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DisplayedRoastTimeline, useDisplayedRoastTimeline } from './useDisplayedRoastTimeline';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));

const point = (time: number): LiveRoastPoint => ({
    time,
    label: '',
    bt: 200,
    et: 210,
    ror: null,
    ror_et: null,
    heater: null,
    fan: 0,
    drum: 0,
});
const waitPoint = (t: number) => ({ t, bt: 200, et: 210, heater: null, fan: 0, drum: 0 });
const entry = (id: string, timeSec: number): LogEntry => ({
    id,
    timeSec,
    time: '',
    event: 'Note',
    note: id,
    temp: '',
    tempC: null,
});

describe('displayed roast timeline interface', () => {
    let root: Root;
    let result: DisplayedRoastTimeline | undefined;
    let settings: ReturnType<typeof getRoastSettings>;
    let reference: { roast: TsvPoint[]; bbp: TsvPoint[]; bbpError: boolean };
    let reviewEntries: LogEntry[] | null;
    const Probe = () => {
        result = useDisplayedRoastTimeline({ bbpEnabled: true, settings, reference, reviewEntries });
        return null;
    };
    const render = () => act(() => root.render(createElement(Probe)));
    const timeline = () => {
        if (!result) throw new Error('Missing timeline');
        return result;
    };

    beforeEach(() => {
        useRoastingStore.getState().reset();
        useRoastingStore.setState({ phase: 'standby' });
        useBbpStore.setState({ active: false, recording: false, startMs: 0, points: [], events: [] });
        settings = { ...getRoastSettings(), bbpJoinCharge: true, timeRangeCustom: false, timeRangePresetMin: 13 };
        reference = { roast: [], bbp: [], bbpError: false };
        reviewEntries = null;
        result = undefined;
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => {
        act(() => root.unmount());
        useRoastingStore.getState().reset();
        useBbpStore.setState({ active: false, recording: false, points: [], events: [] });
    });

    it('aligns displayed events and inverse edits without moving the viewport origin or losing hidden rows', async () => {
        reference.roast = [{ t: 0, bt: 190, et: null, ror: null, heater: null, fan: 0, drum: 0 }];
        const events = [entry('hidden', 30), entry('visible', 900)];
        useBbpStore.setState({ active: true, startMs: 1, points: [waitPoint(0), waitPoint(960)], events });
        await render();
        expect(timeline().entries).toEqual([expect.objectContaining({ id: 'visible', timeSec: 840 })]);
        expect(timeline().chart.maxTime).toBe(900);
        expect(timeline().frame.displayedElapsed).toBe(900);
        const read = timeline().editing.read;
        expect(read().editEntries(events, 'visible', { timeSec: 850 })).toEqual([
            events[0],
            expect.objectContaining({ id: 'visible', timeSec: 910 }),
        ]);
        expect(events[1].timeSec).toBe(900);

        await act(() => useBbpStore.setState({ points: [waitPoint(0), waitPoint(1020)] }));
        expect(timeline().entries[0].timeSec).toBe(780);
        expect(read().editEntries(events, 'visible', { timeSec: 790 })[1].timeSec).toBe(910);
    });

    it('preserves a selected real interval across joined Charge and resets it for the next wait', async () => {
        const chargeMs = Date.now();
        useBbpStore.setState({ active: true, startMs: chargeMs - 120_000, points: [waitPoint(1), waitPoint(119)] });
        await render();
        await act(() => timeline().chart.setZoomRange({ start: 0, end: 100 }));
        await act(() => {
            useRoastingStore.getState().startCharge(chargeMs, 'owner');
            useRoastingStore.setState({ livePoints: [point(0), point(10)] });
            useBbpStore.setState({ active: false });
        });
        expect(timeline().chart.effectiveZoomRange).toEqual({ start: -119, end: -20 });
        expect(timeline().frame.bbpRange).toEqual({ start: -119, end: 0 });
        expect(timeline().editing.read().kind).toBe('live');
        await act(() => {
            useRoastingStore.getState().reset();
            useBbpStore.setState({ active: true, startMs: chargeMs + 1000, points: [waitPoint(0)] });
        });
        expect(timeline().chart.effectiveZoomRange).toBeNull();
    });

    it('preserves a zoomed measurement and event through a long wait, late reference, and Charge', async () => {
        const chargeMs = Date.now();
        const points = [300, 400, 500, 600, 900, 960, 1200].map(waitPoint);
        useBbpStore.setState({
            active: true,
            startMs: chargeMs - 1_200_000,
            points: points.filter((p) => p.t <= 900),
            events: [entry('marked', 400)],
        });
        await render();
        await act(() => timeline().chart.setZoomRange({ start: 300, end: 600 }));
        await act(() => useBbpStore.setState({ points: points.filter((p) => p.t <= 960) }));
        expect(timeline().chart.effectiveZoomRange).toEqual({ start: 240, end: 540 });
        expect(timeline().chart.visibleControlXs).toEqual([240, 340, 440, 540]);
        expect(timeline().entries[0].timeSec).toBe(340);
        reference.roast = [0, 301, 720].map((t) => ({ ...waitPoint(t), ror: 1 }));
        await render();
        expect(timeline().chart.effectiveZoomRange).toEqual({ start: 240, end: 540 });
        expect(timeline().chart.maxTime).toBe(1620);
        expect(timeline().chart.targetSeries.map((p) => p.time)).toEqual([900, 1201, 1620]);
        await act(() => useBbpStore.setState({ points }));
        expect(timeline().chart.effectiveZoomRange).toEqual({ start: 0, end: 300 });
        expect(timeline().entries[0].timeSec).toBe(100);
        await act(() => {
            useRoastingStore.getState().startCharge(chargeMs, 'owner');
            useRoastingStore.setState({ livePoints: [point(0), point(10)] });
            useBbpStore.setState({ active: false });
        });
        expect(timeline().chart.effectiveZoomRange).toEqual({ start: -900, end: -600 });
        expect(timeline().chart.visibleControlXs).toEqual([-900, -800, -700, -600]);
        expect(timeline().entries.find((e) => e.id === 'marked')?.timeSec).toBe(-800);
        expect(
            timeline()
                .chart.targetSeries.filter((p) => p.time >= 0)
                .map((p) => p.time),
        ).toEqual([0, 301, 720]);
    });

    it.each(['PREHEAT', 'READY'])(
        'moves %s reference Charge with BBP growth while measurements, controls and events stay aligned',
        async (phase) => {
            const chargeMs = Date.now();
            useRoastingStore.getState().enterPreheating();
            if (phase === 'READY') useRoastingStore.getState().enterStandby();
            const savedBbp = [20, 80, 340].map((t) => ({ ...waitPoint(t), ror: null, bbpChargeOffsetSec: 360 }));
            reference = {
                bbp: savedBbp,
                roast: [0, 301, 1200].map((t) => ({ ...waitPoint(t), ror: 1 })),
                bbpError: false,
            };
            const original = structuredClone(reference);
            useBbpStore.setState({ active: true, startMs: chargeMs - 1_200_000, points: [] });
            await render();
            expect(timeline().chart.targetSeries.map((p) => p.time)).toEqual([20, 80, 340, 360, 661, 1560]);
            expect(timeline().chart.maxTime).toBe(1560);
            expect(timeline().chart.visibleControlXs).toEqual([]);
            expect(timeline().frame.bbpRange).toEqual({ start: 0, end: 360 });
            for (const latest of [1, 359, 360, 361, 600, 899, 900, 901, 1200]) {
                await act(() =>
                    useBbpStore.setState({
                        points: [{ ...waitPoint(latest), heater: 40, fan: 30 }],
                        events: [entry('expired', 0), entry('mark', latest), entry('future', 2000)],
                    }),
                );
                const current = Math.min(latest, 900);
                const charge = Math.max(360, current);
                expect(timeline().chart.targetSeries.map((p) => p.time)).toEqual([
                    charge - 340,
                    charge - 280,
                    charge - 20,
                    charge,
                    charge + 301,
                    charge + 1200,
                ]);
                expect(timeline().frame.bbpRange).toEqual({ start: 0, end: charge });
                expect(timeline().chart.maxTime).toBe(charge + 1200);
                expect(timeline().chart.visibleControlXs).toEqual([current]);
                expect(timeline().chart.visibleHeatPower).toEqual([40]);
                expect(timeline().chart.visibleFanSpeed).toEqual([30]);
                expect(
                    timeline()
                        .chart.visibleChartData.filter((p) => p.btActual != null || p.etActual != null)
                        .map((p) => p.time),
                ).toEqual([current]);
                expect(timeline().frame.displayedElapsed).toBe(current);
                expect(timeline().entries.find((e) => e.id === 'mark')?.timeSec).toBe(current);
                expect(timeline().entries.some((e) => e.id === 'future')).toBe(false);
                expect(timeline().bbpObservationNow().timeSec).toBe(latest);
                expect(useBbpStore.getState().points[0].t).toBe(latest);
            }
            expect(timeline().entries.some((e) => e.id === 'expired')).toBe(false);
            const stored = useBbpStore.getState().events;
            const edited = timeline().editing.read().editEntries(stored, 'mark', { timeSec: 190 });
            expect(edited.find((e) => e.id === 'mark')?.timeSec).toBe(490);
            expect(edited.find((e) => e.id === 'expired')).toEqual(stored[0]);
            expect(edited.find((e) => e.id === 'future')?.timeSec).toBe(2000);
            await act(() => timeline().chart.setZoomRange({ start: 100, end: 200 }));
            for (const range of [3, 60]) {
                settings = { ...settings, timeRangePresetMin: range };
                await render();
                expect(timeline().chart.maxTime).toBe(2100);
                expect(timeline().chart.effectiveZoomRange).toEqual({ start: 100, end: 200 });
            }
            expect(reference).toEqual(original);
            await act(() => useBbpStore.setState({ points: [waitPoint(300), waitPoint(1200)] }));
            await act(() => {
                useRoastingStore.getState().startCharge(chargeMs, 'owner');
                useRoastingStore.setState({ livePoints: [point(0)] });
                useBbpStore.setState({ active: false });
            });
            expect(timeline().chart.effectiveZoomRange).toEqual({ start: -800, end: -700 });
            expect(timeline().chart.maxTime).toBe(3600);
            expect(
                timeline()
                    .chart.targetSeries.filter((p) => p.time >= 0)
                    .map((p) => p.time),
            ).toEqual([0, 301, 1200]);
            await act(() => timeline().chart.setZoomRange({ start: 0, end: 200 }));
            settings = { ...settings, timeRangePresetMin: 3 };
            await render();
            expect(timeline().chart.effectiveZoomRange).toBeNull();
            expect(timeline().chart.maxTime).toBe(180);
        },
    );

    it('preserves a selected real interval while the BBP viewport grows, then rolls after 15 minutes', async () => {
        reference = {
            bbp: [0, 360].map((t) => ({ ...waitPoint(t), ror: null })),
            roast: [0, 60].map((t) => ({ ...waitPoint(t), ror: 1 })),
            bbpError: false,
        };
        const samples = [0, 300, 360, 361, 600, 900, 901, 1200].map((t) => ({
            ...waitPoint(t),
            bt: 200 + t / 100,
            heater: t / 10,
            fan: t / 20,
        }));
        useBbpStore.setState({
            active: true,
            startMs: 1,
            points: samples.filter((p) => p.t <= 360),
            events: [entry('marked', 300)],
        });
        await render();
        expect(timeline().chart.maxTime).toBe(420);
        await act(() => timeline().chart.setZoomRange({ start: 300, end: 360 }));
        for (const latest of [361, 600, 900, 901, 1200]) {
            await act(() => useBbpStore.setState({ points: samples.filter((p) => p.t <= latest) }));
            const origin = Math.max(0, latest - 900);
            const times = [300 - origin, 360 - origin];
            const charge = Math.min(900, latest);
            expect(timeline().chart.effectiveZoomRange).toEqual({ start: times[0], end: times[1] });
            expect(timeline().chart.maxTime).toBe(charge + 60);
            expect(timeline().chart.visibleControlXs).toEqual(times);
            expect(timeline().chart.visibleHeatPower).toEqual([30, 36]);
            expect(timeline().chart.visibleFanSpeed).toEqual([15, 18]);
            expect(
                timeline()
                    .chart.visibleChartData.filter((p) => p.btActual != null)
                    .map((p) => [p.time, p.btActual]),
            ).toEqual([
                [times[0], 203],
                [times[1], 203.6],
            ]);
            expect(timeline().entries[0].timeSec).toBe(times[0]);
            expect(timeline().chart.targetSeries.map((p) => p.time)).toEqual([
                charge - 360,
                charge,
                charge,
                charge + 60,
            ]);
        }
    });

    it('applies the configured roast extent after Charge with BBP joining off', async () => {
        settings = { ...settings, bbpJoinCharge: false, timeRangePresetMin: 3 };
        reference = {
            bbp: [0, 200].map((t) => ({ ...waitPoint(t), ror: null })),
            roast: [0, 1200].map((t) => ({ ...waitPoint(t), ror: 1 })),
            bbpError: false,
        };
        useBbpStore.setState({ active: true, startMs: Date.now() - 600_000, points: [waitPoint(0), waitPoint(600)] });
        await render();
        expect(timeline().chart.maxTime).toBe(1800);
        expect(timeline().chart.visibleControlXs).toEqual([0, 600]);
        await act(() => timeline().chart.setZoomRange({ start: 0, end: 200 }));
        await act(() => {
            useRoastingStore.getState().startCharge(Date.now(), 'owner');
            useRoastingStore.setState({ livePoints: [point(0)] });
            useBbpStore.setState({ active: false });
        });
        expect(timeline().chart.maxTime).toBe(180);
        expect(timeline().frame.bbpRange).toBeUndefined();
        expect(timeline().chart.effectiveZoomRange).toBeNull();
        expect(timeline().chart.visibleControlXs).toEqual([0]);
    });

    it('hides future BBP notes from the roast reference with no saved BBP or measured span', async () => {
        reference.roast = [0, 1200].map((t) => ({ ...waitPoint(t), ror: 1 }));
        const future = entry('future', 1800);
        useBbpStore.setState({ active: true, points: [], events: [future] });
        await render();
        expect(timeline().entries).toEqual([]);
        await act(() => useBbpStore.setState({ points: [waitPoint(600)], events: [entry('now', 600), future] }));
        expect(timeline().frame.bbpRange).toBeUndefined();
        expect(timeline().entries.map((e) => e.id)).toEqual(['now']);
        expect(useBbpStore.getState().events[1]).toEqual(future);
    });

    it('reads the new Charge source when an old BBP editing callback runs', async () => {
        reference.roast = [{ t: 0, bt: 190, et: null, ror: null, heater: null, fan: 0, drum: 0 }];
        useBbpStore.setState({ active: true, startMs: Date.now() - 960_000, points: [waitPoint(960)] });
        await render();
        const read = timeline().editing.read;
        await act(() => {
            useRoastingStore.getState().startCharge(Date.now(), 'owner');
            useRoastingStore.setState({ livePoints: [point(10), point(20)], elapsed: 30 });
            useBbpStore.setState({ active: false });
            const target = read();
            expect(target.kind).toBe('live');
            expect(target.editEntries([entry('new', 10)], 'new', { timeSec: 20 })[0].timeSec).toBe(20);
        });
    });

    it('isolates review geometry from background BBP while retaining the live command-record clock', async () => {
        const state = useRoastingStore.getState();
        state.prepareWorkspace('owner');
        const id = state.startCharge(undefined, 'owner');
        if (!id) throw new Error('Missing session');
        useRoastingStore.setState({ elapsed: 30, livePoints: [point(10), point(20)] });
        state.abortRoast(200, 'C');
        state.saveSucceeded('owner', id);
        useBbpStore.setState({ active: true, points: [waitPoint(150)], events: [entry('wait', 150)] });
        reviewEntries = [entry('saved', 12)];
        await render();
        expect(timeline().entries).toEqual(reviewEntries);
        expect(timeline().editing.current.kind).toBe('review');
        expect(timeline().editing.read().maxTimeSec).toBe(30);
        expect(timeline().bbpObservationNow().timeSec).toBe(150);
        expect(useBbpStore.getState().events[0].id).toBe('wait');
        const read = timeline().editing.read;
        await act(() => {
            useRoastingStore.getState().dismissCompletedReview();
            expect(read().kind).toBe('bbp');
        });
    });

    it('keeps BBP command times unchanged when joining is disabled and the reference BBP failed', async () => {
        settings.bbpJoinCharge = false;
        reference.roast = [{ t: 0, bt: 190, et: null, ror: null, heater: null, fan: 0, drum: 0 }];
        reference.bbpError = true;
        useBbpStore.setState({ active: true, startMs: 1, points: [waitPoint(960)], events: [entry('wait', 900)] });
        await render();
        expect(timeline().frame.targetPointCount).toBe(1);
        expect(timeline().entries[0].timeSec).toBe(840);
        expect(timeline().bbpObservationNow()).toEqual({ timeSec: 960, tempC: 200 });
    });
});
