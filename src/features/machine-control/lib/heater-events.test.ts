import { describe, expect, it } from 'vitest';
import {
    formatEditTime,
    heaterEventsToJson,
    normalizeHeaterPlan,
    parseEditTime,
    parseHeaterEvents,
    resolveReplayPlan,
} from './heater-events';
import { extractReplayEvents, judgeReplay, type ReplayPoint } from './replay';

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

describe('parseHeaterEvents', () => {
    it('유효 배열만 통과하고 trigger를 보존한다', () => {
        expect(parseHeaterEvents([{ t: 10, bt: 192, heater: 50, trigger: 'bt' }])).toEqual([
            { t: 10, bt: 192, heater: 50, trigger: 'bt' },
        ]);
        expect(parseHeaterEvents(null)).toBeNull();
        expect(parseHeaterEvents([])).toBeNull();
        expect(parseHeaterEvents([{ t: 0, bt: 180, heater: 80, trigger: 'nope' }])).toBeNull();
    });
});

describe('parseEditTime', () => {
    it('m:ss 와 초 60을 허용한다', () => {
        expect(parseEditTime('1:30')).toBe(90);
        expect(parseEditTime('0:60')).toBe(60);
        expect(parseEditTime('12:05')).toBe(725);
        expect(parseEditTime('1:99')).toBeNull();
        expect(parseEditTime('abc')).toBeNull();
    });

    it('formatEditTime은 왕복된다', () => {
        expect(parseEditTime(formatEditTime(90))).toBe(90);
        expect(formatEditTime(5)).toBe('0:05');
    });
});

describe('resolveReplayPlan', () => {
    const points = curve({ 0: 80, 120: 60, 300: 40 });

    it('배치 > 프로파일 > TSV 추출 순이다', () => {
        const tsv = resolveReplayPlan({ points });
        expect(tsv.source).toBe('tsv');
        expect(tsv.plan?.events.map((e) => e.heater)).toEqual([80, 60, 40]);

        const profile = resolveReplayPlan({
            points,
            profileEvents: [{ t: 0, bt: 180, heater: 70 }],
        });
        expect(profile.source).toBe('profile');
        expect(profile.plan?.events.map((e) => e.heater)).toEqual([70]);

        const batch = resolveReplayPlan({
            points,
            profileEvents: [{ t: 0, bt: 180, heater: 70 }],
            batchEvents: [{ t: 0, bt: 180, heater: 55, trigger: 'time' }],
        });
        expect(batch.source).toBe('batch');
        expect(batch.plan?.events[0]?.heater).toBe(55);
    });

    it('TSV 없이 BT 규칙만으로 plan이 된다 (#437)', () => {
        const resolved = resolveReplayPlan({
            points: null,
            batchEvents: [{ t: 0, bt: 192, heater: 50, trigger: 'bt' }],
        });
        expect(resolved.source).toBe('batch');
        const plan = resolved.plan;
        expect(plan?.tpTime).toBe(Number.POSITIVE_INFINITY);
        if (!plan) throw new Error('fixture broken');
        const miss = judgeReplay(plan, 0, { bt: 191, elapsed: 200, afterTurningPoint: true });
        expect(miss.heater).toBeNull();
        const hit = judgeReplay(plan, 0, { bt: 192, elapsed: 200, afterTurningPoint: true });
        expect(hit).toEqual({ nextIndex: 1, heater: 50 });
    });

    it('양수 화력이 없으면 null', () => {
        expect(normalizeHeaterPlan([{ t: 0, bt: 180, heater: 0 }], 60)).toBeNull();
    });
});

describe('heaterEventsToJson', () => {
    it('trigger 없는 행은 필드를 생략한다', () => {
        expect(heaterEventsToJson([{ t: 0, bt: 180, heater: 80 }])).toEqual([{ t: 0, bt: 180, heater: 80 }]);
    });
});

describe('extractReplayEvents fixture still extracts', () => {
    it('resolve tsv matches extract', () => {
        const points = curve({ 0: 80, 300: 40 });
        expect(resolveReplayPlan({ points }).plan).toEqual(extractReplayEvents(points));
    });
});
