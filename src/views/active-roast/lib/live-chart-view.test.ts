import { describe, expect, it } from 'vitest';
import { resolveLiveChartView } from './live-chart-view';

const bbpPt = (t: number, bt: number) => ({ t, bt, et: bt + 10, heater: 20, fan: 15, drum: 50 });
const roastPt = (t: number, bt: number) => ({
    t,
    bt,
    et: bt + 10,
    ror: 1,
    heater: 40,
    fan: 30,
    drum: 50,
});
const livePt = (time: number, bt: number) => ({
    time,
    label: '0:00',
    bt,
    et: bt + 10,
    ror: 1,
    ror_et: 1,
    heater: 40,
    fan: 30,
    drum: 50,
});

const base = {
    livePoints: [livePt(0, 192), livePt(22, 179)],
    bbpPoints: [bbpPt(1, 210), bbpPt(60, 200)],
    roastTarget: [roastPt(0, 192), roastPt(60, 155)],
    bbpTarget: [roastPt(0, 207), roastPt(90, 195)],
    bbpTargetError: false,
};

describe('resolveLiveChartView', () => {
    it('Charge 후에는 BBP 없이 00:00 로스팅만 보여 준다', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: false, charged: true });
        expect(view.xMin).toBe(0);
        expect(view.xMaxFloor).toBeUndefined();
        expect(view.bbpRange).toBeUndefined();
        expect(view.livePoints).toBe(base.livePoints);
        expect(view.targetPoints).toBe(base.roastTarget);
        expect(view.livePoints.every((p) => p.time >= 0)).toBe(true);
        expect(view.targetPoints.every((p) => p.t >= 0)).toBe(true);
    });

    it('BBP 대기 중에는 Charge=0으로 타깃 점선(BBP+로스팅)과 현재 온도를 보여 준다', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false });
        expect(view.bbpRange).toEqual({ start: -90, end: -30 });
        expect(view.xMin).toBe(-90);
        expect(view.xMaxFloor).toBeUndefined();
        expect(view.targetPoints.map((p) => p.t)).toEqual([-90, 0, 60]);
        expect(view.targetPoints.some((p) => p.t > 0)).toBe(true);
        expect(view.livePoints.map((p) => [p.time, p.bt])).toEqual([
            [-89, 210],
            [-30, 200],
        ]);
    });

    it('첫 배치 Charge 전에도 타깃 BBP는 Charge 왼쪽에, 로스팅 점선은 오른쪽에 둔다', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: false, charged: false });
        expect(view.bbpRange).toEqual({ start: -90, end: 0 });
        expect(view.livePoints.map((p) => p.time)).toEqual([-90, -68]);
        expect(view.targetPoints.map((p) => p.t)).toEqual([-90, 0, 60]);
    });

    it('타깃 BBP가 없으면 Charge 전에도 로스팅 점선은 남긴다', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTargetError: true,
        });
        expect(view.bbpRange).toEqual({ start: -60, end: 0 });
        expect(view.xMin).toBe(-60);
        expect(view.targetPoints).toEqual(base.roastTarget);
        expect(view.livePoints.map((p) => p.time)).toEqual([-59, 0]);
    });

    it.each([false, true])('실측 BBP 길이만큼 배경이 늘어난다 (타깃 없음: %s)', (withoutTarget) => {
        for (const elapsed of [1, 60, 90, 120, 180]) {
            const view = resolveLiveChartView({
                ...base,
                bbpActive: true,
                charged: false,
                bbpTarget: withoutTarget ? [] : base.bbpTarget,
                bbpPoints: [bbpPt(1, 210), bbpPt(elapsed, 200)],
            });
            expect(view.bbpRange).toEqual({
                start: withoutTarget ? -elapsed : -90,
                end: withoutTarget ? 0 : elapsed - 90,
            });
            expect((view.bbpRange?.end ?? 0) - (view.bbpRange?.start ?? 0)).toBe(elapsed);
            expect(view.livePoints[view.livePoints.length - 1]?.time).toBe(view.bbpRange?.end);
            expect(view.xMin).toBe(view.bbpRange?.start);
            expect(view.targetPoints.filter((p) => p.t >= 0)).toEqual(base.roastTarget);
            if (!withoutTarget) {
                expect(view.livePoints[0]?.time).toBe(-89);
                expect(view.targetPoints.map((p) => p.t)).toEqual([-90, 0, 60]);
            }
        }
    });

    it('BBP 기록 시작 전에는 실측 배경을 미리 채우지 않는다', () => {
        const view = resolveLiveChartView({ ...base, bbpActive: true, charged: false, bbpPoints: [] });
        expect(view.bbpRange).toBeUndefined();
        expect(view.xMin).toBe(-90);
    });

    it('저장된 BBP도 실측도 없으면 20분 빈 구간을 잡지 않는다', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: [],
            bbpPoints: [],
            bbpSeconds: 1200,
        });
        expect(view.bbpRange).toBeUndefined();
        expect(view.xMin).toBe(0);
        expect(view.targetPoints.every((p) => p.t >= 0)).toBe(true);
    });

    it('6분 기록은 20분 슬롯으로 패딩하지 않는다', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: [roastPt(0, 200), roastPt(360, 190)],
            bbpSeconds: 1200,
            bbpPoints: [bbpPt(1, 210), bbpPt(360, 200)],
        });
        expect(view.xMin).toBe(-360);
        expect(view.bbpRange).toEqual({ start: -360, end: 0 });
        expect((view.bbpRange?.end ?? 0) - (view.bbpRange?.start ?? 0)).toBe(360);
        expect(view.targetPoints.map((p) => p.t)).toEqual([-360, 0, 60]);
        expect(view.livePoints.map((p) => p.time)).toEqual([-359, 0]);
    });

    it('기준 BBP 없이 실측만 있으면 기록된 길이만 보여 준다', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: [],
            bbpSeconds: 1200,
            bbpPoints: [bbpPt(1, 210), bbpPt(360, 200)],
        });
        expect(view.xMin).toBe(-360);
        expect(view.bbpRange).toEqual({ start: -360, end: 0 });
        expect(view.livePoints.map((p) => p.time)).toEqual([-359, 0]);
    });

    it('캡 창 안에 6분만 샘플이 있으면 그 6분만 보여 준다', () => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: [],
            bbpPoints: [bbpPt(900, 210), bbpPt(1260, 200)],
        });
        expect(view.xMin).toBe(-360);
        expect(view.bbpRange).toEqual({ start: -360, end: 0 });
        expect(view.livePoints.map((p) => p.time)).toEqual([-360, 0]);
    });

    it.each([
        { first: 60, last: 1260 },
        { first: 1740, last: 2940 },
    ])('실측이 20분을 넘으면 Charge 직전 20분만 음의 축에 쓴다 ($last s)', ({ first, last }) => {
        const view = resolveLiveChartView({
            ...base,
            bbpActive: true,
            charged: false,
            bbpTarget: [],
            bbpPoints: [bbpPt(first, 210), bbpPt(last, 200)],
        });
        expect(view.xMin).toBe(-1200);
        expect(view.bbpRange).toEqual({ start: -1200, end: 0 });
        expect(view.livePoints.map((p) => p.time)).toEqual([-1200, 0]);
    });
});
