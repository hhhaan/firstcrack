import { describe, expect, it } from 'vitest';
import { extractReplayEvents, judgeReplay, type ReplayPoint } from './replay';

/** charge 180° → TP 95°(t=60) → 상승 → drop 205° 형태의 레퍼런스 */
const curve = (heaterAt: Record<number, number>): ReplayPoint[] => {
    const pts: ReplayPoint[] = [];
    let heater: number | null = null;
    for (let t = 0; t <= 600; t += 10) {
        if (heaterAt[t] != null) heater = heaterAt[t];
        const bt = t <= 60 ? 180 - (t / 60) * 85 : 95 + ((t - 60) / 540) * 110;
        pts.push({ t, bt, heater });
    }
    return pts;
};

describe('extractReplayEvents', () => {
    it('heater 변화점만 이벤트로 뽑고 첫 값을 초기 이벤트로 포함한다', () => {
        const plan = extractReplayEvents(curve({ 0: 80, 120: 60, 300: 40 }));
        expect(plan).not.toBeNull();
        expect(plan?.events.map((e) => e.heater)).toEqual([80, 60, 40]);
        expect(plan?.events[0].t).toBe(0);
    });

    it('TP는 BT 전역 최솟값 시각이다', () => {
        const plan = extractReplayEvents(curve({ 0: 80 }));
        expect(plan?.tpTime).toBe(60);
    });

    it('배출 후 쿨다운 꼬리가 TP보다 식어도 TP는 골짜기로 잡힌다', () => {
        // drop(205°) 이후 세션 종료 전까지 기록된 꼬리 — BT가 TP(95°) 아래로 떨어진다
        const tail: ReplayPoint[] = [
            { t: 610, bt: 150, heater: 0 },
            { t: 660, bt: 90, heater: 0 },
            { t: 720, bt: 60, heater: 0 },
        ];
        const plan = extractReplayEvents([...curve({ 0: 80, 300: 40 }), ...tail]);
        expect(plan?.tpTime).toBe(60);
    });

    it('heater가 전부 null(합성 프로파일)이면 null', () => {
        expect(extractReplayEvents(curve({}))).toBeNull();
    });

    it('pre-charge(t<0) 포인트는 무시한다', () => {
        const pts: ReplayPoint[] = [{ t: -30, bt: 150, heater: 90 }, ...curve({ 100: 70 })];
        const plan = extractReplayEvents(pts);
        expect(plan?.events.map((e) => e.heater)).toEqual([70]);
    });

    it('1% 미만 흔들림은 이벤트가 아니다', () => {
        const plan = extractReplayEvents(curve({ 0: 80, 120: 80.5, 300: 60 }));
        expect(plan?.events.map((e) => e.heater)).toEqual([80, 60]);
    });

    it('이벤트 폭증(PID 기록)이면 null — 재생 부적합', () => {
        const heaterAt: Record<number, number> = {};
        // 매 샘플 ±2%씩 흔들리는 PID duty
        for (let t = 0; t <= 600; t += 10) heaterAt[t] = 60 + (t % 20 === 0 ? 2 : -2);
        expect(extractReplayEvents(curve(heaterAt))).toBeNull();
    });
});

describe('judgeReplay', () => {
    const plan = extractReplayEvents(curve({ 0: 80, 40: 70, 120: 60, 300: 40 }));
    if (!plan) throw new Error('fixture broken');
    // events: t=0 h=80 (pre-TP), t=40 h=70 (pre-TP), t=120 bt≈107 h=60, t=300 bt≈144 h=40

    it('TP 이전 이벤트는 시간축으로 발화한다', () => {
        const r = judgeReplay(plan, 0, { bt: 180, elapsed: 0, afterTurningPoint: false });
        expect(r).toEqual({ nextIndex: 1, heater: 80 });
    });

    it('하강 중(TP 미확정)에는 BT가 이벤트 온도 이상이어도 후반 이벤트가 오발되지 않는다', () => {
        // charge 직후 bt=170 — 레벨 비교였다면 bt≥107, bt≥144 둘 다 참
        const r = judgeReplay(plan, 2, { bt: 170, elapsed: 5, afterTurningPoint: false });
        expect(r).toEqual({ nextIndex: 2, heater: null });
    });

    it('TP 확정 후 레퍼런스 이벤트 BT에 도달하면 발화한다', () => {
        const eventBt = plan.events[2].bt;
        const miss = judgeReplay(plan, 2, { bt: eventBt - 1, elapsed: 200, afterTurningPoint: true });
        expect(miss.heater).toBeNull();
        const hit = judgeReplay(plan, 2, { bt: eventBt + 0.5, elapsed: 200, afterTurningPoint: true });
        expect(hit).toEqual({ nextIndex: 3, heater: 60 });
    });

    it('한 샘플에 여러 이벤트를 넘으면 마지막 값만 쓴다', () => {
        const r = judgeReplay(plan, 0, { bt: 150, elapsed: 500, afterTurningPoint: true });
        expect(r).toEqual({ nextIndex: 4, heater: 40 });
    });

    it('발화한 이벤트는 재발화하지 않는다 (순방향 인덱스)', () => {
        const first = judgeReplay(plan, 0, { bt: 180, elapsed: 45, afterTurningPoint: false });
        expect(first).toEqual({ nextIndex: 2, heater: 70 });
        const again = judgeReplay(plan, first.nextIndex, { bt: 100, elapsed: 50, afterTurningPoint: false });
        expect(again.heater).toBeNull();
    });
});
