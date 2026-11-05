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

describe('resolveLiveChartView', () => {
    it('starts the reference BBP at zero and joins its roast at the saved Charge', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false });
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
        expect(view.axisOrigin).toBe(0);
        expect(view.bbpRange).toEqual({ start: 1, end: 60 });
        expect(view.livePoints.map((p) => p.time)).toEqual([1, 60]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 90, 90, 150]);
        expect(view.eventTimeOrigin).toBe(0);
    });

    it('shows only the roast timeline after Charge', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: false, charged: true });
        expect(view.livePoints).toBe(base.livePoints);
        expect(view.targetPoints).toBe(base.roastTarget);
        expect(view.bbpRange).toBeUndefined();
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBeUndefined();
    });

    it('uses the roast timeline before first Charge when no BBP is active', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: false, charged: false });
        expect(view.livePoints).toBe(base.livePoints);
        expect(view.targetPoints).toBe(base.roastTarget);
    });

    it('grows the BBP axis from zero without a saved target', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTargetError: true,
            bbpPoints: [bbpPt(0), bbpPt(181)],
        });
        expect(view.targetPoints.map((p) => p.t)).toEqual([181, 241]);
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 181]);
        expect(view.xMaxFloor).toBe(900);
        expect(view.bbpRange).toEqual({ start: 0, end: 181 });
    });

    it('keeps the latest 15 minutes of live BBP, including the window boundary', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(0), bbpPt(59), bbpPt(60), bbpPt(660), bbpPt(960)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 600, 900]);
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
        expect(view.bbpRange).toEqual({ start: 0, end: 900 });
        expect(view.eventTimeOrigin).toBe(60);
    });

    it('keeps the saved reference length independent of a 15-minute live window', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(2040), bbpPt(2940)],
            bbpTarget: [roastPt(540), roastPt(900)],
        });
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 900]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([540, 900, 900, 960]);
        expect(view.bbpRange).toEqual({ start: 0, end: 900 });
    });

    it('shows the last 15 minutes of a legacy 20-minute reference without rewriting it', () => {
        const stored = [roastPt(0), roastPt(300), roastPt(700), roastPt(1200)];
        const before = stored.map((p) => ({ ...p }));
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(0), bbpPt(900)],
            bbpTarget: stored,
        });
        expect(stored).toEqual(before);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 400, 900, 900, 960]);
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
    });

    it('keeps a 14-minute live BBP at its measured times', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(2100), bbpPt(2940)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([60, 900]);
        expect(view.bbpRange).toEqual({ start: 60, end: 900 });
        expect(view.xMaxFloor).toBe(900);
    });

    it('leaves the live band empty until measurements arrive and still shows the reference roast', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false, bbpPoints: [] });
        expect(view.livePoints).toEqual([]);
        expect(view.bbpRange).toBeUndefined();
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 90, 90, 150]);
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
    });

    it('retains the complete post-Charge reference beyond the fixed viewport', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(0), bbpPt(240)],
            bbpTarget: [roastPt(0), roastPt(240)],
            roastTarget: [roastPt(-30), roastPt(0), roastPt(90), roastPt(300), roastPt(780)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 240]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 240, 240, 330, 540, 1020]);
        expect(view.xMaxFloor).toBe(900);
    });

    it.each([600, 720, 900])('shows the complete BBP at %i seconds without early clipping', (waitSec) => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(0), bbpPt(waitSec)],
            roastTarget: [roastPt(0), roastPt(300), roastPt(780), roastPt(1200)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, waitSec]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 90, 90, 390, 870, 1290]);
        expect(view.bbpRange).toEqual({ start: 0, end: waitSec });
        expect(view.eventTimeOrigin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
    });

    it('keeps a 15 minute left-aligned wait when no reference roast is selected', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            roastTarget: [],
            bbpPoints: [bbpPt(60), bbpPt(960)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 900]);
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
        expect(view.bbpRange).toEqual({ start: 0, end: 900 });
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 90]);
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
    expect(view.xMaxFloor).toBe(900);
    expect(view.livePoints.map((point) => point.time)).toEqual([1, 60]);
    expect(view.targetPoints.map((point) => point.t)).toEqual([0, 90, 90, 150]);
});

it.each([0, 1, 180, 600, 840, 900, 1200])('keeps the entire reference fixed after %i live seconds', (latest) => {
    const origin = Math.max(0, latest - 900);
    const reference = [0, 299, 300, 301, 600, 720].map(roastPt);
    const view = resolveLiveChartView({
        ...base,
        bbpActive: true,
        charged: false,
        bbpPoints: [0, 180, 300, 600, 840, 900, 1200].filter((t) => t <= latest).map(bbpPt),
        roastTarget: reference,
        bbpTarget: [{ ...roastPt(20), bbpChargeOffsetSec: 200 }, roastPt(160)],
    });
    expect(view.xMaxFixed).toBe(900);
    expect(view.axisOrigin).toBe(origin);
    expect(view.eventTimeOrigin).toBe(origin);
    expect(view.targetPoints.map((p) => p.t)).toEqual([20, 160, ...reference.map((p) => 200 + p.t)]);
    expect(view.livePoints.map((p) => p.time)).toEqual(
        [0, 180, 300, 600, 840, 900, 1200].filter((t) => t >= origin && t <= latest).map((t) => t - origin),
    );
    if (latest === 180)
        expect(view.targetPoints.filter((p) => p.t >= 0 && p.t <= 900).map((p) => p.t)).toEqual([
            20, 160, 200, 499, 500, 501, 800,
        ]);
});

it('keeps sparse observations and their origin independent of reference arrival or failure', () => {
    const input = { ...base, bbpActive: true, charged: false, bbpPoints: [bbpPt(500), bbpPt(1200)] };
    const without = resolveLiveChartView({ ...input, roastTarget: [], bbpTarget: [] });
    const arrived = resolveLiveChartView(input);
    const failed = resolveLiveChartView({ ...input, bbpTargetError: true });
    for (const view of [without, arrived, failed]) {
        expect(view.livePoints.map((p) => p.time)).toEqual([200, 900]);
        expect(view.axisOrigin).toBe(300);
        expect(view.eventTimeOrigin).toBe(300);
        expect(view.bbpRange).toEqual({ start: 200, end: 900 });
    }
    expect(failed.targetPoints.map((p) => p.t)).toEqual([900, 960]);
});

it('retains explicit Charge gaps and clips long legacy references without moving their coordinates', () => {
    const stored = [40, 450, 700, 1190].map((t) => ({ ...roastPt(t), bbpChargeOffsetSec: 1250 }));
    const original = structuredClone(stored);
    for (const latest of [0, 180, 900, 1200]) {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: stored,
            bbpPoints: latest ? [bbpPt(latest)] : [],
        });
        expect(view.targetPoints.map((p) => p.t)).toEqual([100, 350, 840, 900, 960]);
        expect(view.targetPoints.slice(0, 3).every((p) => p.ror === null)).toBe(true);
    }
    expect(stored).toEqual(original);
});

it('preserves sparse saved BBP timestamps and their gaps before explicit Charge', () => {
    const stored = [{ ...roastPt(40), bbpChargeOffsetSec: 200 }, roastPt(100)];
    for (const points of [[], [bbpPt(180)], [bbpPt(1200)]]) {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: stored,
            bbpPoints: points,
        });
        expect(view.targetPoints.map((p) => p.t)).toEqual([40, 100, 200, 260]);
    }
});

it.each([{ initial: [] }, { initial: [roastPt(0)] }])(
    'keeps reference-independent coordinates when a reference arrives or changes',
    ({ initial }) => {
        const input = { ...base, bbpActive: true, charged: false, bbpPoints: [bbpPt(500), bbpPt(1200)] };
        for (const bbpTarget of [initial, base.bbpTarget, [roastPt(20), roastPt(200)]]) {
            const view = resolveLiveChartView({ ...input, bbpTarget });
            expect(view.axisOrigin).toBe(300);
            expect(view.eventTimeOrigin).toBe(300);
            expect(view.livePoints.map((p) => p.time)).toEqual([200, 900]);
        }
    },
);

it.each([0, 60, 180, 900, 1200])(
    'preserves the initial observation gap and explicit Charge at %i live seconds',
    (latest) => {
        const stored = [{ ...roastPt(1), bbpChargeOffsetSec: 60 }, roastPt(59)];
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: stored,
            bbpPoints: latest ? [bbpPt(latest)] : [],
        });
        expect(view.targetPoints.map((p) => p.t)).toEqual([1, 59, 60, 120]);
    },
);
