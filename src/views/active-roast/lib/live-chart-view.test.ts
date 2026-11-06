import { describe, expect, it } from 'vitest';
import { resolveLiveChartView } from './live-chart-view';

const bbpPt = (t: number) => ({ t, bt: 210, et: 220, heater: 20, fan: 15, drum: 50 });
const roastPt = (t: number) => ({ t, bt: 192, et: 202, ror: 1, heater: 40, fan: 30, drum: 50 });
const livePt = (time: number) => ({
    time,
    label: '0:00',
    bt: 192,
    et: 202,
    ror: 1,
    ror_et: 1,
    heater: 40,
    fan: 30,
    drum: 50,
});
const base = {
    livePoints: [livePt(0), livePt(22)],
    bbpPoints: [bbpPt(1), bbpPt(60)],
    roastTarget: [roastPt(0), roastPt(60)],
    bbpTarget: [roastPt(0), roastPt(90)],
    bbpTargetError: false,
};

describe('waiting BBP display', () => {
    it('fits the complete fixed BBP and Charge-to-Drop reference before measurements arrive', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [],
            roastTarget: [roastPt(-30), ...base.roastTarget],
        });
        expect(view.livePoints).toEqual([]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 90, 90, 150]);
        expect(view.bbpRange).toEqual({ start: 0, end: 90 });
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(150);
        expect(view.xMaxFixed).toBe(150);
        expect(view.axisOrigin).toBe(0);
    });

    it('drops only oldest display samples at the saved Charge boundary instead of moving the reference', () => {
        const points = [bbpPt(0), bbpPt(16), bbpPt(17), bbpPt(388), bbpPt(405)];
        const target = [roastPt(0), roastPt(388)];
        const original = structuredClone({ points, target });
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: points,
            bbpTarget: target,
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 371, 388]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 388, 388, 448]);
        expect(view.bbpRange).toEqual({ start: 0, end: 388 });
        expect(view.axisOrigin).toBe(17);
        expect(view.eventTimeOrigin).toBe(17);
        expect(view.xMaxFixed).toBe(448);
        expect({ points, target }).toEqual(original);
    });

    it.each([
        { latest: 0, origin: 0, times: [0] },
        { latest: 60, origin: 0, times: [0, 60] },
        { latest: 90, origin: 0, times: [0, 60, 90] },
        { latest: 91, origin: 1, times: [59, 89, 90] },
        { latest: 405, origin: 315, times: [90] },
        { latest: 900, origin: 810, times: [90] },
        { latest: 1200, origin: 1110, times: [90] },
    ])('keeps the reference fixed while measured BBP rolls at $latest seconds', ({ latest, origin, times }) => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [0, 60, 90, 91, 405, 900, 1200].filter((t) => t <= latest).map(bbpPt),
            roastTarget: [roastPt(0), roastPt(300), roastPt(1200)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual(times);
        expect(view.eventTimeOrigin).toBe(origin);
        expect(view.axisOrigin).toBe(origin);
        expect(view.bbpRange).toEqual({ start: 0, end: 90 });
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 90, 90, 390, 1290]);
        expect(view.xMaxFixed).toBe(1290);
        expect(view.livePoints.every((p) => p.ror === null && p.ror_et === null)).toBe(true);
    });

    it('preserves sparse saved timestamps and explicit Charge gaps while the measured window rolls', () => {
        const saved = [{ ...roastPt(40), bbpChargeOffsetSec: 200 }, roastPt(100)];
        const original = structuredClone(saved);
        for (const latest of [0, 180, 600, 1200]) {
            const view = resolveLiveChartView({
                ...base,
                bbpActive: true,
                charged: false,
                bbpTarget: saved,
                bbpPoints: latest ? [bbpPt(latest)] : [],
            });
            expect(view.targetPoints.map((p) => p.t)).toEqual([40, 100, 200, 260]);
            expect(view.bbpRange).toEqual({ start: 0, end: 200 });
            expect(view.eventTimeOrigin).toBe(Math.max(0, latest - 200));
        }
        expect(saved).toEqual(original);
    });

    it('clips a legacy reference to 15 minutes, retaining its observation gaps and the entire roast', () => {
        const saved = [40, 450, 700, 1190].map((t) => ({ ...roastPt(t), bbpChargeOffsetSec: 1250 }));
        const original = structuredClone(saved);
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: saved,
            bbpPoints: [bbpPt(0), bbpPt(60), bbpPt(960)],
        });
        expect(view.targetPoints.map((p) => p.t)).toEqual([100, 350, 840, 900, 960]);
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 900]);
        expect(view.bbpRange).toEqual({ start: 0, end: 900 });
        expect(view.eventTimeOrigin).toBe(60);
        expect(view.xMaxFixed).toBe(960);
        expect(saved).toEqual(original);
    });

    it('keeps a positive saved BBP window even when there is no roast reference', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            roastTarget: [],
            bbpPoints: [bbpPt(60), bbpPt(960)],
        });
        expect(view.xMaxFixed).toBe(90);
        expect(view.livePoints.map((p) => p.time)).toEqual([90]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 90]);
    });

    it('infers the Charge boundary from legacy saved samples without metadata', () => {
        const saved = [0, 300, 700, 1200].map(roastPt);
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: saved,
            bbpPoints: [bbpPt(0), bbpPt(60), bbpPt(960)],
        });
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 400, 900, 900, 960]);
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 900]);
        expect(view.bbpRange).toEqual({ start: 0, end: 900 });
        expect(view.xMaxFixed).toBe(960);
        expect(saved.map((p) => p.t)).toEqual([0, 300, 700, 1200]);
    });

    it.each([
        { bbpTarget: [], bbpTargetError: false },
        { bbpTarget: [roastPt(0)], bbpTargetError: false },
        { bbpTarget: base.bbpTarget, bbpTargetError: true },
    ])('falls back to the 15-minute measured window without hiding the available roast: %j', (target) => {
        const view = resolveLiveChartView({
            ...base,
            ...target,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(0), bbpPt(59), bbpPt(60), bbpPt(660), bbpPt(960)],
            roastTarget: [roastPt(0), roastPt(1200)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 600, 900]);
        expect(view.eventTimeOrigin).toBe(60);
        expect(view.bbpRange).toEqual({ start: 0, end: 900 });
        expect(view.targetPoints.slice(-2).map((p) => p.t)).toEqual([900, 2100]);
        expect(view.xMaxFixed).toBe(2100);
    });

    it('shades only measured BBP with no saved reference and leaves an empty wait unshaded', () => {
        const input = { ...base, bbpActive: true, charged: false, bbpTarget: [], roastTarget: [] };
        expect(resolveLiveChartView({ ...input, bbpPoints: [] }).bbpRange).toBeUndefined();
        const view = resolveLiveChartView({ ...input, bbpPoints: [bbpPt(1), bbpPt(60)] });
        expect(view.bbpRange).toEqual({ start: 1, end: 60 });
        expect(view.xMaxFixed).toBe(900);
    });

    it('rebases the measured display consistently when a late reference arrives, changes or fails', () => {
        const input = { ...base, bbpActive: true, charged: false, bbpPoints: [bbpPt(500), bbpPt(1140), bbpPt(1200)] };
        for (const { target, error, origin, times } of [
            { target: [], error: false, origin: 300, times: [200, 840, 900] },
            { target: base.bbpTarget, error: false, origin: 1110, times: [30, 90] },
            { target: [roastPt(20), roastPt(200)], error: false, origin: 1000, times: [140, 200] },
            { target: base.bbpTarget, error: true, origin: 300, times: [200, 840, 900] },
        ]) {
            const view = resolveLiveChartView({ ...input, bbpTarget: target, bbpTargetError: error });
            expect(view.livePoints.map((p) => p.time)).toEqual(times);
            expect(view.axisOrigin).toBe(origin);
            expect(view.eventTimeOrigin).toBe(origin);
        }
    });

    it('uses the ordinary roast view when Charge has no saved BBP or waiting is inactive', () => {
        for (const state of [
            { bbpActive: false, charged: true },
            { bbpActive: false, charged: false },
        ]) {
            const view = resolveLiveChartView({ ...base, ...state });
            expect(view.livePoints).toBe(base.livePoints);
            expect(view.targetPoints).toBe(base.roastTarget);
            expect(view.bbpRange).toBeUndefined();
            expect(view.xMaxFixed).toBeUndefined();
            expect(view.xMaxFloor).toBeUndefined();
        }
    });
});

it('keeps pre-Charge observations and aligns references by Charge without stretching either curve', () => {
    const original = [bbpPt(0), bbpPt(60), bbpPt(119), bbpPt(120), bbpPt(123)];
    const view = resolveLiveChartView({
        ...base,
        bbpActive: false,
        charged: true,
        livePoints: [livePt(0), livePt(3)],
        bbpCapture: {
            sessionId: 'a',
            generation: 'wait-a',
            startMs: 1000,
            chargeMs: 121000,
            recording: true,
            points: original,
            events: [],
        },
        bbpTarget: [roastPt(0), roastPt(180)],
    });
    expect(view.livePoints.map((point) => point.time)).toEqual([-120, -60, -1, 0, 3]);
    expect(view.livePoints.filter((point) => point.time < 0).every((point) => point.ror === null)).toBe(true);
    expect(view.targetPoints.map((point) => point.t)).toEqual([-180, 0, 60]);
    expect(view.bbpRange).toEqual({ start: -120, end: 0 });
    expect(view.eventTimeOrigin).toBe(120);
    expect(original.map((point) => point.t)).toEqual([0, 60, 119, 120, 123]);
});

it('starts the charged chart at Charge when BBP is not joined', () => {
    const view = resolveLiveChartView({
        ...base,
        bbpActive: false,
        charged: true,
        joinBbp: false,
        livePoints: [livePt(0), livePt(3)],
        bbpCapture: {
            sessionId: 'a',
            generation: 'wait-a',
            startMs: 1000,
            chargeMs: 121000,
            recording: true,
            points: [bbpPt(0), bbpPt(60), bbpPt(120)],
            events: [],
        },
        bbpTarget: [roastPt(0), roastPt(180)],
    });
    expect(view.livePoints.map((point) => point.time)).toEqual([0, 3]);
    expect(view.targetPoints.map((point) => point.t)).toEqual([0, 60]);
    expect(view.bbpRange).toBeUndefined();
    expect(view.xMin).toBe(0);
    expect(view.eventTimeOrigin).toBe(0);
});

it('keeps the reference roast on the wait chart when BBP is not joined into Charge', () => {
    const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false, joinBbp: false });
    expect(view.xMin).toBe(0);
    expect(view.xMaxFloor).toBe(150);
    expect(view.livePoints.map((point) => point.time)).toEqual([1, 60]);
    expect(view.targetPoints.map((point) => point.t)).toEqual([0, 90, 90, 150]);
});
