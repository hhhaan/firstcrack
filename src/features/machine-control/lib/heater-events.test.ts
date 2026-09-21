import { describe, expect, it } from 'vitest';
import {
    carryReplayEventIds,
    formatEditTime,
    heaterEventsToJson,
    heaterFitsBounds,
    normalizeHeaterPlan,
    numericHeaterStep,
    parseEditTime,
    parseFiniteNumber,
    parseHeaterEvents,
    profileHeaterBounds,
    remapReplayIndex,
    resolveHeaterBounds,
    resolveReplayPlan,
} from './heater-events';
import { extractReplayEvents, judgeReplay, type ReplayPoint } from './replay';

const curve = (heaterAt: Record<number, number>): ReplayPoint[] => {
    const pts: ReplayPoint[] = [];
    let heater: number | null = null;
    for (let t = 0; t <= 600; t += 10) {
        if (heaterAt[t] != null) heater = heaterAt[t];
        const bt = t <= 60 ? 180 - (t / 60) * 85 : 95 + ((t - 60) / 540) * 110;
        pts.push({ t, bt, heaterSet: heater });
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

describe('parseFiniteNumber', () => {
    it('rejects empty, whitespace, NaN, Infinity', () => {
        expect(parseFiniteNumber('')).toBeNull();
        expect(parseFiniteNumber('  ')).toBeNull();
        expect(parseFiniteNumber('abc')).toBeNull();
        expect(parseFiniteNumber(Number.NaN)).toBeNull();
        expect(parseFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
        expect(parseFiniteNumber('50')).toBe(50);
        expect(parseFiniteNumber(0)).toBe(0);
    });
});

describe('heaterFitsBounds', () => {
    it('uses device min/max/step, not 0–100', () => {
        expect(heaterFitsBounds(7, { min: 1, max: 10, step: 1 })).toBe(true);
        expect(heaterFitsBounds(11, { min: 1, max: 10, step: 1 })).toBe(false);
        expect(heaterFitsBounds(150, { min: 1, max: 100 })).toBe(false);
        expect(heaterFitsBounds(50.5, { min: 1, max: 100, step: 1 })).toBe(false);
        expect(heaterFitsBounds(1, { min: 1, max: 100 })).toBe(true);
    });
});

describe('parseHeaterEvents invalid numbers', () => {
    it('rejects blank, NaN, Infinity heater/BT', () => {
        expect(parseHeaterEvents([{ t: 0, bt: 180, heater: '' }])).toBeNull();
        expect(parseHeaterEvents([{ t: 0, bt: '  ', heater: 50 }])).toBeNull();
        expect(parseHeaterEvents([{ t: 0, bt: 180, heater: Number.NaN }])).toBeNull();
        expect(parseHeaterEvents([{ t: 0, bt: Number.POSITIVE_INFINITY, heater: 50 }])).toBeNull();
    });
});

describe('resolveReplayPlan invalid override', () => {
    const points = curve({ 0: 80, 120: 60 });

    it('잘못된 프로파일 jsonb를 TSV로 조용히 대체하지 않는다', () => {
        const resolved = resolveReplayPlan({
            points,
            profileEvents: [{ t: 0, bt: 180, heater: 80, trigger: 'nope' }],
        });
        expect(resolved.overrideInvalid).toBe(true);
        expect(resolved.plan).toBeNull();
        expect(resolved.source).toBe('profile');
    });

    it('범위 밖 배치 편집본을 TSV로 대체하지 않는다', () => {
        const resolved = resolveReplayPlan({
            points,
            batchEvents: [{ t: 0, bt: 180, heater: 150, trigger: 'time' }],
            heaterMin: 1,
            heaterMax: 100,
        });
        expect(resolved.overrideInvalid).toBe(true);
        expect(resolved.plan).toBeNull();
        expect(resolved.source).toBe('batch');
    });

    it('원본 복원(null)만 TSV로 돌아간다', () => {
        const resolved = resolveReplayPlan({ points, profileEvents: null });
        expect(resolved.overrideInvalid).toBe(false);
        expect(resolved.source).toBe('tsv');
        expect(resolved.plan?.events.map((e) => e.heater)).toEqual([80, 60]);
    });
});

describe('remapReplayIndex', () => {
    const A = { id: 'a', t: 0, bt: 180, heater: 80, trigger: 'time' as const };
    const B = { id: 'b', t: 60, bt: 140, heater: 70, trigger: 'time' as const };
    const C = { id: 'c', t: 120, bt: 110, heater: 50, trigger: 'bt' as const };
    const X = { id: 'x', t: 10, bt: 170, heater: 75, trigger: 'time' as const };

    it('실행한 행을 지우면 다음 미실행 행을 건너뛰지 않는다', () => {
        expect(remapReplayIndex([A, B, C], 1, [B, C])).toBe(0);
    });

    it('실행 지점 앞 삽입은 재실행하지 않는다', () => {
        expect(remapReplayIndex([A, B, C], 2, [X, A, B, C])).toBe(3);
    });

    it('consumed heater/time edits keep the same row id', () => {
        expect(remapReplayIndex([A, B, C], 1, [{ ...A, heater: 90, t: 5 }, B, C])).toBe(1);
    });

    it('unlabeled edits keep the acked prefix instead of matching heater', () => {
        const old = [{ t: 0, bt: 180, heater: 80, trigger: 'time' as const }];
        const next = [
            { t: 0, bt: 180, heater: 90, trigger: 'time' as const },
            { t: 120, bt: 110, heater: 60, trigger: 'bt' as const },
        ];
        expect(remapReplayIndex(old, 1, next)).toBe(1);
    });
});

describe('carryReplayEventIds', () => {
    it('keeps explicit ids and inherits unlabeled slots', () => {
        const prev = carryReplayEventIds([{ t: 0, bt: 180, heater: 80 }]);
        const next = carryReplayEventIds(
            [
                { t: 0, bt: 180, heater: 90 },
                { t: 30, bt: 160, heater: 55 },
            ],
            prev,
        );
        expect(next[0]?.id).toBe(prev[0]?.id);
        expect(next[1]?.id).not.toBe(prev[0]?.id);
    });
});

describe('resolveHeaterBounds / profileHeaterBounds', () => {
    it('falls back to 0–100% when machine limits are unknown', () => {
        expect(resolveHeaterBounds()).toEqual({ min: 0, max: 100, unit: '%' });
        expect(numericHeaterStep(undefined)).toBeUndefined();
        expect(numericHeaterStep(1)).toBe(1);
        expect(profileHeaterBounds({ machine_roaster_key: 'missing' }, [], {})).toEqual({
            min: 0,
            max: 100,
            unit: '%',
            origin: 'fallback',
        });
    });

    it('reads write_map heater from saved machine params, including real step', () => {
        expect(
            profileHeaterBounds(
                { machine_id: 'm1', machine_roaster_key: 'giesen_wxa_coarse' },
                [
                    {
                        id: 'm1',
                        roasterKey: 'giesen_wxa_coarse',
                        connectionParams: { write_map: { heater: { min: 1, max: 10, unit: 'step' } } },
                    },
                ],
                {},
            ),
        ).toEqual({ min: 1, max: 10, unit: 'step', origin: 'saved' });
        expect(
            resolveHeaterBounds({
                params: { write_map: { heater: { min: 1, max: 10, unit: 'step', step: 1 } } },
            }),
        ).toEqual({ min: 1, max: 10, unit: 'step', step: 1 });
        expect(resolveHeaterBounds({ min: 1, max: 100, unit: '%' }).step).toBeUndefined();
    });

    it('uses live /status heater limits only when the connected roaster matches', () => {
        const profile = { machine_roaster_key: 'giesen_wxa_coarse' };
        expect(
            profileHeaterBounds(
                profile,
                [],
                {},
                {
                    roaster: 'giesen_wxa_coarse',
                    heater: { min: 1, max: 10, unit: 'step' },
                },
            ),
        ).toEqual({ min: 1, max: 10, unit: 'step', origin: 'live' });
        expect(
            profileHeaterBounds(
                profile,
                [],
                {},
                {
                    roaster: 'virtual',
                    heater: { min: 1, max: 10, unit: 'step' },
                },
            ),
        ).toEqual({ min: 0, max: 100, unit: '%', origin: 'fallback' });
    });
});

describe('resolveReplayPlan step', () => {
    const points = curve({ 0: 80, 120: 60 });

    it('does not invent a step; 50.5 is valid without one', () => {
        const resolved = resolveReplayPlan({
            points,
            batchEvents: [{ t: 0, bt: 180, heater: 50.5, trigger: 'time' }],
            heaterMin: 1,
            heaterMax: 100,
        });
        expect(resolved.overrideInvalid).toBe(false);
        expect(resolved.plan?.events[0]?.heater).toBe(50.5);
    });

    it('rejects a nonrepresentable heater when the device step is present', () => {
        const resolved = resolveReplayPlan({
            points,
            batchEvents: [{ t: 0, bt: 180, heater: 50.5, trigger: 'time' }],
            heaterMin: 1,
            heaterMax: 100,
            heaterStep: 1,
        });
        expect(resolved.overrideInvalid).toBe(true);
        expect(resolved.plan).toBeNull();
    });
});
