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
    it('starts the wait at 0 and joins the reference roast at the live Charge', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false });
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
        expect(view.axisOrigin).toBe(0);
        expect(view.bbpRange).toEqual({ start: 1, end: 60 });
        expect(view.livePoints.map((p) => p.time)).toEqual([1, 60]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([60, 120]);
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

    it('aligns the reference BBP at the end of a 15-minute live window', () => {
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
        expect(view.targetPoints.map((p) => p.t)).toEqual([540, 900, 960]);
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
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 400, 900, 960]);
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
    });

    it('keeps a 14-minute live BBP before the reference Charge', () => {
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
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 60]);
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
    });

    it('keeps the short roast preview limited to five minutes after BBP', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(0), bbpPt(240)],
            bbpTarget: [roastPt(0), roastPt(240)],
            roastTarget: [roastPt(-30), roastPt(0), roastPt(90), roastPt(300), roastPt(780)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 240]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 240, 330, 540]);
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
        expect(view.targetPoints.map((p) => p.t)).toEqual([waitSec - 90, waitSec, waitSec + 300]);
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
    expect(view.targetPoints.map((point) => point.t)).toEqual([60, 120]);
});
