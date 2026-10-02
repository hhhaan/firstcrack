import { isChartEventMarker } from '@features/active-roast/lib/chart-config';
import { deriveRoastMetrics } from '@shared/lib/roast-delta';
import { describe, expect, it } from 'vitest';
import { ADDABLE_KEY_EVENTS, applyEventDrafts, nextAddableEvent, recordSummary, toEventDrafts } from './record-edit';

const stored = [
    { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200.37 },
    { id: 'n', type: 'Note', time_sec: 30, note: 'gas', extra: { keep: true } },
    { id: 'y', type: 'Yellow', time_sec: 250.4, temp_c: 160 },
    { id: 'f', type: 'FC Start', time_sec: 480, temp_c: 196 },
    { id: 'h', type: 'Heater', time_sec: 500, note: '60%' },
    { id: 'd', type: 'Drop', time_sec: 600, temp_c: 210.2 },
    { id: 'e', type: 'End', time_sec: 640, temp_c: null },
    { id: 'm', type: 'Mystery', time_sec: 700 },
];

const drafts = (unit: 'C' | 'F' = 'C') => toEventDrafts(stored, unit);
const set = (unit: 'C' | 'F', patch: Record<string, { time?: string; temp?: string }>) =>
    drafts(unit).map((d) => ({ ...d, ...patch[d.type] }));

describe('toEventDrafts', () => {
    it('lists only key marks in roast order with display precision', () => {
        expect(drafts().map((d) => [d.type, d.time, d.temp])).toEqual([
            ['Charge', '0:00', '200.4'],
            ['Yellow', '4:10', '160'],
            ['FC Start', '8:00', '196'],
            ['Drop', '10:00', '210.2'],
            ['End', '10:40', ''],
        ]);
        expect(drafts('F')[0].temp).toBe('392.7');
    });
});

describe('applyEventDrafts', () => {
    it('no edits keeps the stored array byte-identical', () => {
        const res = applyEventDrafts(stored, drafts(), 'C');
        expect(res).toEqual({ ok: true, events: stored, changed: false });
    });

    it('patches time/temp in place and preserves unknown rows and fields', () => {
        const res = applyEventDrafts(stored, set('C', { 'FC Start': { time: '7:50', temp: '195.5' } }), 'C');
        if (!res.ok) throw new Error('expected ok');
        const events = res.events as typeof stored;
        expect(events).toHaveLength(stored.length);
        expect(events[3]).toEqual({ id: 'f', type: 'FC Start', time_sec: 470, temp_c: 195.5 });
        expect(events[1]).toBe(stored[1]);
        expect(events[2]).toBe(stored[2]);
        expect(events[7]).toBe(stored[7]);
        expect(res.changed).toBe(true);
    });

    it('converts °F input back to °C at 0.1 precision', () => {
        const res = applyEventDrafts(stored, set('F', { Drop: { temp: '410' } }), 'F');
        if (!res.ok) throw new Error('expected ok');
        expect((res.events as typeof stored)[5].temp_c).toBe(210);
    });

    it('keeps Charge on the 0:00 axis even if the time field is edited', () => {
        const res = applyEventDrafts(stored, set('C', { Charge: { time: '0:30', temp: '205' } }), 'C');
        if (!res.ok) throw new Error('expected ok');
        expect((res.events as typeof stored)[0]).toEqual({ id: 'c', type: 'Charge', time_sec: 0, temp_c: 205 });
    });

    it.each([
        ['empty temp', { Drop: { temp: '' } }, 5, 'temp'],
        ['non-number temp', { Drop: { temp: '21o' } }, 5, 'temp'],
        ['out of range temp', { Drop: { temp: '999' } }, 5, 'temp'],
        ['bad time', { Yellow: { time: '4:7' } }, 2, 'time'],
        ['empty time', { Yellow: { time: '' } }, 2, 'time'],
        ['order inversion', { 'FC Start': { time: '10:30' } }, 5, 'order'],
        ['drop after end', { Drop: { time: '11:00' } }, 6, 'order'],
    ] as const)('rejects %s', (_label, patch, index, code) => {
        const res = applyEventDrafts(stored, set('C', patch), 'C');
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.errors[index]).toBe(code);
    });

    it('allows an empty temp when the mark never had one', () => {
        expect(applyEventDrafts(stored, drafts(), 'C').ok).toBe(true);
    });
});

describe('recordSummary', () => {
    const session = { events: stored, duration_seconds: 641, drop_temp_celsius: 210, charge_temp_celsius: 198 };

    it('derives drop temp, DTR and keeps duration when End did not move', () => {
        const res = applyEventDrafts(stored, set('C', { 'FC Start': { time: '7:30' }, Drop: { temp: '212.6' } }), 'C');
        if (!res.ok) throw new Error('expected ok');
        const s = recordSummary(session, res.events);
        expect(s.durationSeconds).toBe(641);
        expect(s.dropTempCelsius).toBe(213);
        expect(s.profileSummary).toEqual({
            charge_temp_celsius: 200,
            drop_temp_celsius: 213,
            duration_sec: 600,
            dev_time_sec: 150,
            dev_pct: 25,
        });
    });

    it('moves duration_seconds with End', () => {
        const res = applyEventDrafts(stored, set('C', { End: { time: '11:00' } }), 'C');
        if (!res.ok) throw new Error('expected ok');
        expect(recordSummary(session, res.events).durationSeconds).toBe(660);
    });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('nextAddableEvent', () => {
    it('prefers a missing FC Start, then the other singletons, then none', () => {
        expect(nextAddableEvent([])).toBe('FC Start');
        expect(nextAddableEvent(['FC Start'])).toBe('Yellow');
        expect(nextAddableEvent(ADDABLE_KEY_EVENTS)).toBeNull();
    });
});

describe('applyEventDrafts additions', () => {
    const noFc = stored.filter((e) => e.type !== 'FC Start');
    const add = (type: string, time: string, temp: string, index = -1) => [
        ...toEventDrafts(noFc, 'C'),
        { index, type, time, temp },
    ];

    it('inserts FC Start, keeps ids and untouched rows, and recomputes develop time', () => {
        const res = applyEventDrafts(noFc, add('FC Start', '8:00', '196'), 'C');
        if (!res.ok) throw new Error('expected ok');
        const events = res.events as typeof stored;
        const fc = events.find((e) => e.type === 'FC Start');
        expect(fc).toMatchObject({ type: 'FC Start', time_sec: 480, temp_c: 196 });
        expect(fc?.id).toMatch(UUID_RE);
        expect(events.filter((e) => e.id === fc?.id)).toHaveLength(1);
        expect(events.find((e) => e.type === 'Note')).toBe(stored[1]);
        expect(events.find((e) => e.type === 'Heater')).toBe(stored[4]);
        expect(events.find((e) => e.type === 'Mystery')).toBe(stored[7]);
        expect(events.find((e) => e.type === 'Charge')).toEqual(stored[0]);
        expect(events.map((e) => e.time_sec)).toEqual([0, 30, 250.4, 480, 500, 600, 640, 700]);

        const session = { events: noFc, duration_seconds: 641, drop_temp_celsius: 210, charge_temp_celsius: 198 };
        const summary = recordSummary(session, events);
        const metrics = deriveRoastMetrics(
            events.map((e) => ({ type: e.type, time_sec: e.time_sec })),
            { durationFallback: summary.durationSeconds },
        );
        expect(summary.durationSeconds).toBe(641);
        expect(summary.profileSummary).toMatchObject({ dev_time_sec: 120, dev_pct: 20, duration_sec: 600 });
        expect(metrics.devTimeSec).toBe(120);
        expect(metrics.dtrPct).toBe(20);
        // Chart markers read this same array. Develop time is Drop − FC Start.
        expect(isChartEventMarker(fc?.type ?? '')).toBe(true);
        expect(fc?.time_sec).toBe(600 - (metrics.devTimeSec ?? 0));
    });

    it('inserts several missing marks in time order and converts °F', () => {
        const drafts = [
            ...toEventDrafts(stored, 'F'),
            { index: -1, type: 'FC End', time: '9:00', temp: '401' },
            { index: -2, type: 'TP', time: '1:30', temp: '' },
        ];
        const res = applyEventDrafts(stored, drafts, 'F');
        if (!res.ok) throw new Error('expected ok');
        const events = res.events as Array<{ id: string; type: string; time_sec: number; temp_c: number | null }>;
        expect(events.map((e) => e.type)).toEqual([
            'Charge',
            'Note',
            'TP',
            'Yellow',
            'FC Start',
            'Heater',
            'FC End',
            'Drop',
            'End',
            'Mystery',
        ]);
        expect(events.find((e) => e.type === 'TP')).toMatchObject({ time_sec: 90, temp_c: null });
        expect(events.find((e) => e.type === 'FC End')?.temp_c).toBe(205);
        const ids = events.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(events.find((e) => e.type === 'Note')).toBe(stored[1]);
    });

    it('allows FC Rolling at the same time as FC Start', () => {
        const res = applyEventDrafts(
            stored,
            [...drafts(), { index: -1, type: 'FC Rolling', time: '8:00', temp: '196' }],
            'C',
        );
        expect(res.ok).toBe(true);
    });

    it('does not rename an existing mark when the draft type changes', () => {
        const renamed = drafts().map((d) => (d.type === 'FC Start' ? { ...d, type: 'Yellow' } : d));
        const res = applyEventDrafts(stored, renamed, 'C');
        expect(res).toEqual({ ok: true, events: stored, changed: false });
    });

    it.each([
        [
            'duplicate FC Start',
            stored,
            [...drafts(), { index: -1, type: 'FC Start', time: '8:10', temp: '197' }],
            -1,
            'duplicate',
        ],
        ['new Drop boundary', noFc, add('Drop', '10:00', '210'), -1, 'duplicate'],
        [
            'new Charge boundary',
            noFc.filter((e) => e.type !== 'Charge'),
            [
                ...toEventDrafts(
                    noFc.filter((e) => e.type !== 'Charge'),
                    'C',
                ),
                { index: -1, type: 'Charge', time: '0:00', temp: '200' },
            ],
            -1,
            'duplicate',
        ],
        ['empty time', noFc, add('FC Start', '', '196'), -1, 'time'],
        ['out of range temp', noFc, add('FC Start', '8:00', '999'), -1, 'temp'],
        ['FC after Drop', noFc, add('FC Start', '11:00', '196'), 4, 'order'],
    ] as const)('rejects %s', (_label, raw, rows, index, code) => {
        const res = applyEventDrafts(raw, [...rows], 'C');
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.errors[index]).toBe(code);
    });
});

it('adds and edits Color Change and second crack while preserving stored rows', () => {
    const added = applyEventDrafts(
        stored,
        [
            ...drafts(),
            { index: -1, type: 'Color Change', time: '5:00', temp: '175' },
            { index: -2, type: 'SC Start', time: '9:30', temp: '205' },
        ],
        'C',
    );
    if (!added.ok) throw new Error('expected valid additions');
    expect(isChartEventMarker('Color Change')).toBe(true);
    expect(isChartEventMarker('SC Start')).toBe(true);
    const nextDrafts = toEventDrafts(added.events, 'F').map((d) =>
        d.type === 'SC Start' ? { ...d, time: '9:40', temp: '410' } : d,
    );
    const edited = applyEventDrafts(added.events, nextDrafts, 'F');
    if (!edited.ok) throw new Error('expected valid edit');
    expect(edited.events).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ type: 'SC Start', time_sec: 580, temp_c: 210 }),
            stored[1],
            stored[7],
        ]),
    );
    const invalid = applyEventDrafts(
        stored,
        [...drafts(), { index: -1, type: 'SC Start', time: '11:00', temp: '205' }],
        'C',
    );
    expect(invalid.ok).toBe(false);
});
