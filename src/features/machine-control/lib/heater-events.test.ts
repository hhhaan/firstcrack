import { describe, expect, it } from 'vitest';
import {
    applyTimeEdit,
    carryReplayEventIds,
    editedHeatSet,
    formatEditTime,
    type HeaterBounds,
    heaterEventsToJson,
    heaterFitsBounds,
    normalizeHeaterPlan,
    numericHeaterStep,
    parseEditTime,
    parseFiniteNumber,
    parseHeaterEvents,
    profileHeaterBounds,
    profileHeatTarget,
    remapReplayIndex,
    resolveHeaterBounds,
    resolveReplayPlan,
    validateHeaterDraft,
    withEditedHeaterLog,
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

describe('profileHeatTarget', () => {
    it('uses profile commands over TSV, cuts off at Drop, and holds the last value', () => {
        const points = curve({ 0: 80, 120: 60, 300: 40 });
        expect(profileHeatTarget(points, 240, null)).toEqual({ xs: [0, 120, 240], values: [80, 60, 60] });
        expect(
            profileHeatTarget(points, 240, [
                { t: 120, bt: 110, heater: 55 },
                { t: 0, bt: 180, heater: 70 },
                { t: 300, bt: 155, heater: 30 },
            ]),
        ).toEqual({ xs: [0, 120, 240], values: [70, 55, 55] });
        expect(profileHeatTarget(points, 240, [{ t: 0, bt: 180, heater: '' }])).toBeUndefined();
    });
});

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
        expect(parseEditTime('')).toBeNull();
        expect(parseEditTime('5')).toBe(300);
        expect(parseEditTime('12')).toBe(720);
        expect(parseEditTime('12:')).toBe(720);
        expect(parseEditTime('12:3')).toBe(750);
        expect(parseEditTime('12:03')).toBe(723);
    });

    it('formatEditTime은 왕복된다', () => {
        expect(parseEditTime(formatEditTime(90))).toBe(90);
        expect(formatEditTime(5)).toBe('0:05');
    });
});

const typeInto = (chars: string) => {
    let state = { value: '', caret: 0, suppress: false, secondsOpen: false, digits: '' };
    for (const ch of chars) {
        const kind = ch === '\b' ? 'backspace' : 'insert';
        state = applyTimeEdit(
            state.value,
            state.caret,
            state.caret,
            kind === 'insert' ? ch : '',
            kind,
            state.suppress,
            state.secondsOpen,
            state.digits,
        );
    }
    return state;
};

describe('applyTimeEdit', () => {
    it('네 칸을 왼쪽부터 채운다', () => {
        let state = { value: '', caret: 0, suppress: false, secondsOpen: false, digits: '' };
        const seen: string[] = ['|'];
        for (const ch of '1234') {
            state = applyTimeEdit(
                state.value,
                state.caret,
                state.caret,
                ch,
                'insert',
                state.suppress,
                state.secondsOpen,
                state.digits,
            );
            seen.push(`${state.value.slice(0, state.caret)}|${state.value.slice(state.caret)}`);
        }
        expect(seen.join(' ')).toBe('| 1|0:00 12:|00 12:3|0 12:34|');
        expect(parseEditTime(state.value)).toBe(754);
        expect(typeInto('0530').value).toBe('05:30');
        expect(parseEditTime('05:30')).toBe(330);
        expect(typeInto('1230').value).toBe('12:30');
        expect(typeInto('1641').value).toBe('16:41');
        expect(typeInto('0016').value).toBe('00:16');
    });

    it('초 61과 글자는 넣지 않고 백스페이스는 마지막 칸을 지운다', () => {
        expect(typeInto('1260').value).toBe('12:60');
        expect(parseEditTime('12:60')).toBe(780);
        expect(typeInto('1261').value).toBe('12:60');
        expect(typeInto('1299').value).toBe('12:00');
        expect(typeInto('12a34').value).toBe('12:34');
        expect(typeInto('1234\b').value).toBe('12:30');
        const five = typeInto('0530');
        const erased = applyTimeEdit(
            five.value,
            five.caret,
            five.caret,
            '',
            'backspace',
            five.suppress,
            false,
            five.digits,
        );
        expect(erased.digits).toBe('053');
        expect(erased.caret).toBe(4);
        const atEnd = typeInto('12');
        expect(applyTimeEdit(atEnd.value, 5, 5, '', 'backspace', atEnd.suppress, false, atEnd.digits).value).toBe(
            '10:00',
        );
    });

    it('전체를 1234로 바꾸고 칸 하나를 덮어쓴다', () => {
        expect(applyTimeEdit('0:16', 0, 4, '1234', 'insert', false)).toMatchObject({ value: '12:34', caret: 5 });
        expect(applyTimeEdit('12:34', 5, 5, '0', 'insert', false).value).toBe('12:34');
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

    it('classifies saved rows with stored TP even without TSV commands, preserving explicit triggers', () => {
        const events = [
            { t: 40, bt: 160, heater: 80 },
            { t: 120, bt: 110, heater: 60 },
            { t: 180, bt: 150, heater: 50, trigger: 'time' },
            { t: 200, bt: 160, heater: 40, trigger: 'bt' },
        ];
        const resolved = resolveReplayPlan({ points: [], referenceTpTime: 120, profileEvents: events });
        const plan = resolved.plan;
        if (!plan) throw new Error('fixture broken');
        expect(plan.tpTime).toBe(120);
        expect(plan.events).toEqual(events);
        expect(judgeReplay(plan, 0, { elapsed: 180, bt: 200, afterTurningPoint: false })).toEqual({
            nextIndex: 3,
            heater: 50,
        });
    });

    it('0만 있는 편집본도 끄기 명령으로 남긴다', () => {
        expect(normalizeHeaterPlan([{ t: 0, bt: 180, heater: 0 }], 60)?.events).toEqual([{ t: 0, bt: 180, heater: 0 }]);
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

describe('validateHeaterDraft', () => {
    const bounds = { min: 0, max: 100 };
    const row = (heater: string, t = '1:00', bt = '180') => ({ t, bt, heater, trigger: 'time' as const });
    const issueOf = (rows: ReturnType<typeof row>[], limits: HeaterBounds = bounds) => {
        const result = validateHeaterDraft(rows, 'C', limits);
        if (result.ok) throw new Error('expected a draft issue');
        return result.issue;
    };

    it('names the first broken field instead of one invalid result', () => {
        expect(issueOf([row('80', '1:99')])).toEqual({ code: 'time', row: 1 });
        expect(issueOf([row('80', 'abc')])).toEqual({ code: 'time', row: 1 });
        expect(issueOf([row('80', '1:00', '')])).toEqual({ code: 'bt', row: 1 });
        expect(issueOf([row('')])).toEqual({ code: 'heat-empty', row: 1 });
        expect(issueOf([row('80'), row('101')])).toEqual({ code: 'heat-range', row: 2 });
        expect(issueOf([row('50.5')], { min: 0, max: 100, step: 1 })).toEqual({ code: 'heat-step', row: 1 });
    });

    it('saves a 0 with no earlier positive step when the device min is 0', () => {
        const saved = validateHeaterDraft([row('80', '0:00'), row('0', '3:00', '190')], 'C', bounds);
        expect(saved.ok).toBe(true);
        if (!saved.ok) return;
        expect(saved.events.map((event) => event.heater)).toEqual([80, 0]);
        const onlyZero = validateHeaterDraft([row('0')], 'C', bounds);
        expect(onlyZero.ok).toBe(true);
        const leadingZero = validateHeaterDraft([row('0', '0:00'), row('80', '3:00')], 'C', bounds);
        expect(leadingZero.ok).toBe(true);
    });

    it('rejects logical 0 when the live device min is still 1', () => {
        expect(issueOf([row('80', '0:00'), row('0', '3:00')], { min: 1, max: 100 })).toEqual({
            code: 'heat-range',
            row: 2,
        });
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

    it('양수 다음 0과, 0만 있는 편집본을 재생한다', () => {
        const off = resolveReplayPlan({
            points,
            batchEvents: [
                { t: 0, bt: 180, heater: 80, trigger: 'time' },
                { t: 180, bt: 200, heater: 0, trigger: 'time' },
            ],
            heaterMin: 0,
            heaterMax: 100,
        });
        expect(off.overrideInvalid).toBe(false);
        expect(off.plan?.events.map((event) => event.heater)).toEqual([80, 0]);
        const onlyZero = resolveReplayPlan({
            points,
            batchEvents: [{ t: 0, bt: 180, heater: 0, trigger: 'time' }],
            heaterMin: 0,
            heaterMax: 100,
        });
        expect(onlyZero.overrideInvalid).toBe(false);
        expect(onlyZero.plan?.events.map((event) => event.heater)).toEqual([0]);
        expect(onlyZero.source).toBe('batch');
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
    it.each([
        'giesen_standard',
        'giesen_w30a',
        'giesen_w30a_pro',
        'giesen_w15e',
        'giesen_w140a_v1',
        'giesen_w140a_v2',
        'giesen_w1',
        'giesen_sample',
        'giesen_w45a_w60a',
        'giesen_wxa',
        'giesen_wxa_plus',
        'giesen_wxa_coarse',
    ])('allows logical zero in the legacy %s map and preserves custom maps', (key) => {
        const max = key === 'giesen_wxa_coarse' ? 10 : 100;
        const unit = key === 'giesen_wxa_coarse' ? 'step' : '%';
        const heater = { db: 2, offset: 14, area: 6, type: 0, div: 0, min: 1, max, unit };
        const machine = { id: key, roasterKey: key, connectionParams: { write_map: { heater } } };
        const bounds = profileHeaterBounds({ machine_id: machine.id }, [machine], {});
        expect(bounds).toEqual({ min: 0, max, unit, origin: 'saved' });
        const events = [
            { t: 0, bt: 100, heater: max * 0.8 },
            { t: 180, bt: 190, heater: 0 },
        ];
        const saved = parseHeaterEvents(heaterEventsToJson(events));
        expect(saved).toEqual(events);
        expect(normalizeHeaterPlan(saved ?? [], 60, bounds)?.events).toEqual(events);
        expect(
            resolveReplayPlan({ points: [], profileEvents: saved, heaterMin: bounds.min, heaterMax: bounds.max })
                .overrideInvalid,
        ).toBe(false);
        for (const change of [{ offset: 16 }, { db: 3 }, { div: 1 }, { value_offset: 0 }]) {
            const custom = { ...machine, connectionParams: { write_map: { heater: { ...heater, ...change } } } };
            expect(profileHeaterBounds({ machine_id: custom.id }, [custom], {}).min).toBe(1);
        }
        const corrected = {
            ...machine,
            connectionParams: { write_map: { heater: { ...heater, min: 0, value_offset: 1 } } },
        };
        expect(profileHeaterBounds({ machine_id: corrected.id }, [corrected], {})).toEqual(bounds);
        expect(heater.min).toBe(1);
    });
    it.each(['giesen_w6a_pro', 'custom_s7', 'giesen_unknown'])(
        'keeps a custom minimum even with DB2.14 for %s',
        (key) => {
            const machine = {
                id: key,
                roasterKey: key,
                connectionParams: {
                    write_map: {
                        heater: { db: 2, offset: 14, area: 6, type: 0, div: 0, min: 1, max: 100, unit: '%' },
                    },
                },
            };
            expect(profileHeaterBounds({ machine_id: key }, [machine], {}).min).toBe(1);
        },
    );
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

describe('history-edited Heat set (#623)', () => {
    const recorded = [
        { t: -30, bt: 200, heaterSet: 90 },
        { t: 0, bt: 200, heaterSet: 70 },
        { t: 60, bt: 100, heaterSet: 70 },
        { t: 120, bt: 150, heaterSet: 50 },
        { t: 600, bt: 210, heaterSet: 50 },
        { t: 620, bt: 205, heaterSet: 0 },
    ];
    const edit = [
        { t: 0, bt: 200, heater: 65 },
        { t: 90, bt: 120, heater: 45 },
    ];

    it('replaces Heat set inside [0, Drop) only and leaves BBP/cooldown as measured', () => {
        expect(editedHeatSet(recorded, 600, edit)).toEqual([90, 65, 65, 45, 50, 0]);
    });

    it('no edit or an unreadable edit draws the TSV as-is', () => {
        expect(editedHeatSet(recorded, 600, null)).toBeNull();
        expect(editedHeatSet(recorded, 600, [{ t: 'x' }])).toBeNull();
    });

    it('edited plan replaces recorded Heater log rows and keeps every other event', () => {
        const events = [
            { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
            { id: 'h', type: 'Heater', time_sec: 100, temp_c: 130, note: '50%' },
            { id: 'n', type: 'Note', time_sec: 110, note: 'x' },
        ];
        expect(withEditedHeaterLog(events, null, 'kPa')).toBe(events);
        expect(withEditedHeaterLog(events, edit, 'kPa')).toEqual([
            { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
            { id: 'heater-plan-0', type: 'Heater', time_sec: 0, temp_c: 200, note: '65kPa' },
            { id: 'heater-plan-1', type: 'Heater', time_sec: 90, temp_c: 120, note: '45kPa' },
            { id: 'n', type: 'Note', time_sec: 110, note: 'x' },
        ]);
    });
});
