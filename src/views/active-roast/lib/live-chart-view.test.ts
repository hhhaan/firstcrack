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
    it('starts measured and target BBP at the left without joining the roast curve', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false });
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
        expect(view.bbpRange).toEqual({ start: 0, end: 59 });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 59]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 90]);
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
        expect(view.targetPoints).toEqual([]);
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 181]);
        expect(view.xMaxFloor).toBe(900);
        expect(view.bbpRange).toEqual({ start: 0, end: 181 });
    });

    it('clips a 16 minute recording to the last 15 minutes', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(0), bbpPt(60), bbpPt(960)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 900]);
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
        expect(view.bbpRange).toEqual({ start: 0, end: 900 });
    });

    it('starts the retained 15 minute window at zero', () => {
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
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 360]);
        expect(view.bbpRange).toEqual({ start: 0, end: 900 });
    });

    it('shows only the last 15 minutes of a legacy 20 minute reference without rewriting it', () => {
        const stored = [roastPt(0), roastPt(300), roastPt(1200)];
        const before = stored.map((p) => ({ ...p }));
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(0)],
            bbpTarget: stored,
        });
        expect(stored).toEqual(before);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 900]);
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
    });

    it('starts at the left when the first retained sample is later than the window origin', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(2100), bbpPt(2940)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 840]);
        expect(view.xMaxFloor).toBe(900);
    });

    it('leaves the BBP background empty until measurements arrive', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false, bbpPoints: [] });
        expect(view.livePoints).toEqual([]);
        expect(view.bbpRange).toBeUndefined();
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(900);
    });
});
