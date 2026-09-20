import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTsv } from '@shared/lib/tsv';
import { describe, expect, it } from 'vitest';
import { eventTrigger, extractReplayEvents, judgeReplay, type ReplayPoint } from './replay';

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

    it('TP는 첫 하강→상승 전환점(골짜기) 시각이다', () => {
        const plan = extractReplayEvents(curve({ 0: 80 }));
        expect(plan?.tpTime).toBe(60);
    });

    it('peak-at-charge 커브(#310): charge BT를 끝까지 못 넘어도 TP는 골짜기로 잡힌다', () => {
        // 실데이터 형상: charge 200° → 145°까지 하강(t=140) → 168°까지만 회복
        const pts: ReplayPoint[] = [];
        for (let t = 0; t <= 320; t += 4) {
            const bt = t <= 140 ? 200 - (t / 140) * 55 : 145 + ((t - 140) / 180) * 23;
            pts.push({ t, bt, heater: null });
        }
        const heaterAt: Record<number, number> = { 0: 75, 56: 90, 72: 12, 80: 84, 100: 18, 132: 71, 316: 47 };
        for (const p of pts) if (heaterAt[p.t] != null) p.heater = heaterAt[p.t];

        const plan = extractReplayEvents(pts);
        expect(plan?.tpTime).toBe(140);
        // 하강 구간 이벤트 6건은 시간축(t ≤ TP), 회복 구간 1건만 BT 트리거
        expect(plan?.events.map((e) => e.heater)).toEqual([75, 90, 12, 84, 18, 71, 47]);
        expect(plan?.events.filter((e) => e.t <= 140).map((e) => e.heater)).toEqual([75, 90, 12, 84, 18, 71]);
    });

    it('#310 실데이터: TP는 실제 골짜기, 시간축 5 + BT 2로 분류되고 7건 전부 순서대로 발화한다', () => {
        // "테스트임" 레퍼런스 원본 TSV — charge 200.2° → 145.5°(t≈122.5) → 168°까지만 회복
        const points = parseTsv(
            readFileSync(fileURLToPath(new URL('./__fixtures__/issue310-reference.tsv', import.meta.url)), 'utf8'),
        );
        const plan = extractReplayEvents(points);
        expect(plan).not.toBeNull();
        if (!plan) return;

        expect(plan.events.map((e) => e.heater)).toEqual([75, 90, 12, 84, 18, 71, 47]);
        // 골짜기(145.5°) 시각 — 하강 중 ±0.1° 흔들림이 마진(2°)을 뚫고 TP를 앞당기지 않아야 한다
        expect(plan.tpTime).toBeGreaterThan(120);
        expect(plan.tpTime).toBeLessThan(127);
        // 하강 구간 5건은 시간축, 회복 중 기록된 71·47은 BT 트리거(임계 오름차순 → collapse 없음)
        expect(plan.events.filter((e) => e.t <= plan.tpTime).map((e) => e.heater)).toEqual([75, 90, 12, 84, 18]);

        // 레퍼런스 커브를 라이브 피드로 재생 시뮬레이션 — 7건 전부, 기록 순서대로 발화
        const fired: number[] = [];
        let index = 0;
        for (const p of points) {
            if (p.t < 0) continue;
            const r = judgeReplay(plan, index, { bt: p.bt, elapsed: p.t, afterTurningPoint: p.t > plan.tpTime });
            if (r.nextIndex > index) for (let i = index; i < r.nextIndex; i++) fired.push(plan.events[i].heater);
            index = r.nextIndex;
        }
        expect(fired).toEqual([75, 90, 12, 84, 18, 71, 47]);
    });

    it('단조 하강만 있는 세션은 TP 미확정(Infinity) — 전 이벤트 시간축', () => {
        const pts: ReplayPoint[] = [];
        for (let t = 0; t <= 120; t += 10) pts.push({ t, bt: 200 - t, heater: t === 0 ? 75 : null });
        expect(extractReplayEvents(pts)?.tpTime).toBe(Number.POSITIVE_INFINITY);
    });

    it('마진 미만의 미세 회복(센서 흔들림)은 TP로 확정하지 않는다', () => {
        // t=20에서 +1° 블립(마진 2° 미만) → 무시, 진짜 골짜기 t=50에서 +3° 회복 → 확정
        const bts = [200, 190, 191, 180, 170, 160, 163, 166];
        const pts: ReplayPoint[] = bts.map((bt, i) => ({ t: i * 10, bt, heater: i === 0 ? 75 : null }));
        expect(extractReplayEvents(pts)?.tpTime).toBe(50);
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

    it('dropTime 이후 포인트(배출 후 쿨다운 조작)는 이벤트에서 제외한다', () => {
        // drop(600s) 후 쿨다운 중 슬라이더 조작 — BT 하강 꼬리라 이번 배치의 발전 구간과 겹친다
        const tail: ReplayPoint[] = [
            { t: 610, bt: 160, heater: 69 },
            { t: 660, bt: 163, heater: 21 },
            { t: 720, bt: 165, heater: 100 },
        ];
        const plan = extractReplayEvents([...curve({ 0: 80, 300: 40 }), ...tail], 600);
        expect(plan?.events.map((e) => e.heater)).toEqual([80, 40]);
    });

    it('화력 채널 없는 머신의 TSV 왕복: 빈 칸 → null → 재생 부적합', () => {
        // 레코더가 실제로 쓰는 형식(useSidecarPolling): heater 열이 빈 문자열.
        // 이 왕복이 깨지면 빈 칸이 0으로 파싱돼 charge에서 화력 0이 나간다.
        const header = 'time\tbt\tet\tror\theater\tfan\tdrum\n';
        const rows = [0, 30, 60, 120, 300].map((t) => `${t.toFixed(2)}\t${200 - t / 4}\t210\t-5\t\t0\t0\n`).join('');
        const points = parseTsv(header + rows);
        expect(points.every((p) => p.heater === null)).toBe(true);
        expect(extractReplayEvents(points)).toBeNull();
    });

    it('heater가 전부 null(합성 프로파일)이면 null', () => {
        expect(extractReplayEvents(curve({}))).toBeNull();
    });

    it('양수가 한 번도 없는 기록(읽기 전용 기종 0 / Giesen unlock 없음 -1)은 null — charge에서 버너를 끄지 않는다', () => {
        expect(extractReplayEvents(curve({ 0: 0 }))).toBeNull();
        expect(extractReplayEvents(curve({ 0: -1 }))).toBeNull();
    });

    it('음수 구간은 null로 건너뛰고, 양수 뒤의 0(가스 컷)은 이벤트로 남는다', () => {
        const plan = extractReplayEvents(curve({ 0: 80, 100: -1, 200: 0, 300: 60 }));
        expect(plan?.events.map((e) => e.heater)).toEqual([80, 0, 60]);
    });

    it('charge 직후 글리치 골짜기(t<20)는 TP로 확정하지 않는다 — 하강 구간 조작이 BT축으로 밀리지 않는다', () => {
        // t=10에 140°로 푹 꺼졌다가 t=20 자연 하강값(151.7°)이 +2° 이상 "회복"으로 보이는 형상.
        // floor가 없으면 tpTime=10이 되어 t=30 가스 조작이 BT축(실기 TP 이후)으로 밀린다.
        const pts = curve({ 0: 80, 30: 60 }).map((p) => (p.t === 10 ? { ...p, bt: 140 } : p));
        const plan = extractReplayEvents(pts);
        expect(plan?.tpTime).toBe(60);
        expect(plan?.events.filter((e) => e.t <= 60).map((e) => e.heater)).toEqual([80, 60]);
    });

    it('Drop 마크 직후 safe-off(heater 0)는 컷오프 밖이다 — 정수 Drop 시각 vs 소수 샘플 시각', () => {
        const plan = extractReplayEvents([...curve({ 0: 80, 300: 40 }), { t: 600.5, bt: 204, heater: 0 }], 600);
        expect(plan?.events.map((e) => e.heater)).toEqual([80, 40]);
    });

    it('Drop 시각(t===cutoff) heater 0은 컷오프 밖이다 — 같은 tick zero write가 다음 배치 계획에 안 섞인다', () => {
        const plan = extractReplayEvents([...curve({ 0: 80, 300: 40 }), { t: 600, bt: 204, heater: 0 }], 600);
        expect(plan?.events.map((e) => e.heater)).toEqual([80, 40]);
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

describe('eventTrigger', () => {
    const plan = extractReplayEvents(curve({ 0: 80, 40: 70, 60: 65, 120: 60, 300: 40 }));
    if (!plan) throw new Error('fixture broken');
    // TP=60. t=0·40 pre-TP, t=60 at-TP, t=120·300 post-TP. Same split as judgeReplay.

    it('TP 이전과 TP와 같은 시각은 time, TP 이후는 bt — 판정 경로와 같다', () => {
        expect(plan.tpTime).toBe(60);
        expect(eventTrigger(plan.events[0], plan.tpTime)).toBe('time');
        expect(eventTrigger(plan.events[1], plan.tpTime)).toBe('time');
        expect(eventTrigger(plan.events[2], plan.tpTime)).toBe('time');
        expect(eventTrigger(plan.events[3], plan.tpTime)).toBe('bt');
        expect(eventTrigger(plan.events[4], plan.tpTime)).toBe('bt');
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
