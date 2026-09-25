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
    it('configured BBP window clips live and target curves together', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpWindowSeconds: 120,
            bbpPoints: [bbpPt(60), bbpPt(180)],
            bbpTarget: [roastPt(0), roastPt(60), roastPt(180)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 120]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 120]);
        expect(view.bbpRange).toEqual({ start: 0, end: 120 });
    });
    it('starts measured and target BBP at the left without joining the roast curve', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false });
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBe(120);
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
        expect(view.xMaxFloor).toBe(300);
        expect(view.bbpRange).toEqual({ start: 0, end: 181 });
    });

    it('starts the retained 20 minute window at zero', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(1740), bbpPt(2940)],
            bbpTarget: [roastPt(540), roastPt(900)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 1200]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([0, 360]);
        expect(view.bbpRange).toEqual({ start: 0, end: 1200 });
    });

    it('starts at the left when the first retained sample is later than the window origin', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpPoints: [bbpPt(1800), bbpPt(2940)],
        });
        expect(view.livePoints.map((p) => p.time)).toEqual([0, 1140]);
    });

    it('leaves the BBP background empty until measurements arrive', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false, bbpPoints: [] });
        expect(view.livePoints).toEqual([]);
        expect(view.bbpRange).toBeUndefined();
        expect(view.xMin).toBe(0);
    });
});
