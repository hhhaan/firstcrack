import { isChartEventMarker } from '@features/active-roast/lib/chart-config';
import { applyEventMarkerEdit } from '@features/active-roast/lib/event-marker-drag';
import { recordSummary } from '@features/active-roast/lib/record-summary';
import { deriveRoastMetrics } from '@shared/lib/roast-delta';
import { describe, expect, it } from 'vitest';
import {
    ADDABLE_KEY_EVENTS,
    applyEventDrafts,
    type EventDraft,
    linkEventDraft,
    measuredCurve,
    nextAddableEvent,
    toEventDrafts,
} from './record-edit';

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
            ['Mystery', '11:40', ''],
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
        const res = applyEventDrafts(stored, set('F', { Yellow: { temp: '410' } }), 'F');
        if (!res.ok) throw new Error('expected ok');
        expect((res.events as typeof stored)[2].temp_c).toBe(210);
    });

    it('leaves Charge and Drop unchanged', () => {
        const res = applyEventDrafts(
            stored,
            set('C', { Charge: { time: '0:30', temp: '205' }, Drop: { time: '11:00', temp: '220' } }),
            'C',
        );
        if (!res.ok) throw new Error('expected ok');
        expect(res.changed).toBe(false);
        expect((res.events as typeof stored)[0]).toBe(stored[0]);
        expect((res.events as typeof stored)[5]).toBe(stored[5]);
    });

    it.each([
        ['empty temp', { Yellow: { temp: '' } }, 2, 'temp'],
        ['non-number temp', { Yellow: { temp: '21o' } }, 2, 'temp'],
        ['out of range temp', { Yellow: { temp: '999' } }, 2, 'temp'],
        ['bad time', { Yellow: { time: '4:7' } }, 2, 'time'],
        ['empty time', { Yellow: { time: '' } }, 2, 'time'],
        ['order inversion', { 'FC Start': { time: '10:30' } }, 5, 'order'],
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
        expect(s.dropTempCelsius).toBe(210);
        expect(s.profileSummary).toEqual({
            charge_temp_celsius: 200,
            drop_temp_celsius: 210,
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

    it('deletes a key mark that left the form and keeps Charge, notes, and unknown rows', () => {
        const res = applyEventDrafts(
            stored,
            drafts().filter((row) => row.type !== 'Yellow'),
            'C',
        );
        if (!res.ok) throw new Error('expected ok');
        const events = res.events as Array<{ type: string }>;
        expect(events.map((event) => event.type)).toEqual([
            'Charge',
            'Note',
            'FC Start',
            'Heater',
            'Drop',
            'End',
            'Mystery',
        ]);
        expect(
            applyEventDrafts(
                stored,
                drafts().filter((row) => row.type !== 'Charge' && row.type !== 'Drop'),
                'C',
            ),
        ).toMatchObject({
            ok: true,
            changed: false,
        });
    });

    it('shows a custom mark in time order and allows the same name twice', () => {
        const withAroma = [
            ...stored,
            { id: 'a1', type: '아로마', time_sec: 90, temp_c: 150 },
            { id: 'a2', type: '아로마', time_sec: 200, temp_c: 170 },
        ];
        expect(toEventDrafts(withAroma, 'C').map((row) => row.type)).toEqual([
            'Charge',
            '아로마',
            '아로마',
            'Yellow',
            'FC Start',
            'Drop',
            'End',
            'Mystery',
        ]);
        const res = applyEventDrafts(
            stored,
            [
                ...drafts(),
                { index: -1, type: '아로마', time: '1:30', temp: '150' },
                { index: -2, type: '아로마', time: '3:20', temp: '170' },
            ],
            'C',
        );
        if (!res.ok) throw new Error('expected ok');
        const events = res.events as Array<{ type: string; time_sec: number }>;
        expect(events.filter((event) => event.type === '아로마').map((event) => event.time_sec)).toEqual([90, 200]);
        const dropped = applyEventDrafts(
            withAroma,
            toEventDrafts(withAroma, 'C').filter(
                (row) => row.index !== withAroma.findIndex((event) => event.id === 'a1'),
            ),
            'C',
        );
        if (!dropped.ok) throw new Error('expected ok');
        expect((dropped.events as Array<{ id?: string }>).some((event) => event.id === 'a1')).toBe(false);
        expect((dropped.events as Array<{ id?: string }>).some((event) => event.id === 'a2')).toBe(true);
        expect((dropped.events as Array<{ type: string }>).some((event) => event.type === 'Note')).toBe(true);
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

const samples = Object.freeze([
    Object.freeze({ time: 0, bt: 200 }),
    Object.freeze({ time: 10, bt: 150 }),
    Object.freeze({ time: 20, bt: 180 }),
    Object.freeze({ time: 100, bt: 150 }),
    Object.freeze({ time: 110, bt: 180 }),
    Object.freeze({ time: 470, bt: 190.04 }),
    Object.freeze({ time: 480, bt: 196 }),
    Object.freeze({ time: 490, bt: 200 }),
    Object.freeze({ time: 600, bt: 210 }),
]);
const curve = measuredCurve(samples);
if (!curve) throw new Error('curve');

const liveReading = (
    event: string,
    timeSec: number,
    tempC: number | null,
    patch: { timeSec?: number; tempC?: number },
    points: readonly { time: number; bt: number }[] = samples,
) => {
    const bound = measuredCurve(points);
    if (!bound) throw new Error('curve');
    const entry = { id: 'e', time: '0:00', timeSec, event, temp: '', tempC, note: '' };
    const next = applyEventMarkerEdit([entry], 'e', patch, points, 'C', bound.maxTimeSec);
    return next[0] === entry ? null : { timeSec: next[0].timeSec ?? null, tempC: next[0].tempC ?? null };
};

const edited = (type: string, patch: Partial<EventDraft>, rows = stored) =>
    toEventDrafts(rows, 'C').map((row) => (row.type === type ? { ...row, ...patch } : row));

describe('history event edits use the live curve rule', () => {
    it('moves temperature to the sample at the edited time and keeps the raw BT', () => {
        const live = liveReading('FC Start', 480, 196, { timeSec: 470 });
        const res = applyEventDrafts(stored, edited('FC Start', { time: '7:50', edited: 'time' }), 'C', curve);
        if (!res.ok) throw new Error('expected ok');
        const events = res.events as typeof stored;
        expect(events[3]).toMatchObject({ id: 'f', time_sec: live?.timeSec, temp_c: live?.tempC });
        expect(events[3].temp_c).toBe(190.04);
        expect(events[0]).toBe(stored[0]);
        expect(events[1]).toBe(stored[1]);
        expect(events[2]).toBe(stored[2]);
        expect(events[4]).toBe(stored[4]);
        expect(events[5]).toBe(stored[5]);
        expect(events[6]).toBe(stored[6]);
        expect(events[7]).toBe(stored[7]);
        expect(samples[5].bt).toBe(190.04);

        const opened = toEventDrafts(events, 'C');
        expect(opened.find((row) => row.type === 'FC Start')).toMatchObject({ time: '7:50', temp: '190' });
        const again = applyEventDrafts(events, opened, 'C', curve);
        expect(again).toMatchObject({ ok: true, changed: false });

        expect(events.find((event) => event.type === 'FC Start')).toMatchObject({ time_sec: 470, temp_c: 190.04 });
        expect(events.find((event) => event.type === 'Yellow')).toMatchObject({ time_sec: 250.4, temp_c: 160 });
        const summary = recordSummary(
            { events: stored, duration_seconds: 641, drop_temp_celsius: 210, charge_temp_celsius: 198 },
            events,
        );
        const metrics = deriveRoastMetrics(
            events.map((event) => ({ type: event.type, time_sec: event.time_sec })),
            { durationFallback: summary.durationSeconds },
        );
        expect(summary.durationSeconds).toBe(641);
        expect(summary.profileSummary).toMatchObject({ dev_time_sec: 130, dev_pct: 21.7, duration_sec: 600 });
        expect(metrics.devTimeSec).toBe(130);
        expect(isChartEventMarker('FC Start')).toBe(true);
    });

    it('moves time to the closest crossing and rejects a temperature the curve never reaches', () => {
        const live = liveReading('FC Start', 480, 196, { tempC: 193 });
        const res = applyEventDrafts(stored, edited('FC Start', { temp: '193', edited: 'temp' }), 'C', curve);
        if (!res.ok) throw new Error('expected ok');
        const fc = (res.events as typeof stored)[3];
        expect(fc).toMatchObject({ time_sec: live?.timeSec, temp_c: 193 });
        expect(fc.time_sec).toBe(475);
        expect((res.events as typeof stored)[2]).toBe(stored[2]);

        for (const temp of ['50', '221']) {
            const rejected = applyEventDrafts(stored, edited('FC Start', { temp, edited: 'temp' }), 'C', curve);
            expect(rejected.ok).toBe(false);
            if (!rejected.ok) expect(rejected.errors[3]).toBe('temp');
        }
        const gap = Object.freeze([Object.freeze({ time: 0, bt: 100 }), Object.freeze({ time: 100, bt: 150 })]);
        const gapped = applyEventDrafts(
            [{ id: 'y', type: 'Yellow', time_sec: 20, temp_c: 120 }],
            [{ index: 0, type: 'Yellow', time: '0:20', temp: '125', edited: 'temp' }],
            'C',
            measuredCurve(gap),
        );
        expect(gapped.ok).toBe(false);
        expect(liveReading('Yellow', 20, 120, { tempC: 125 }, gap)).toBeNull();
    });

    it('picks the repeated temperature closest to the event and clamps a time past the curve', () => {
        const yellow = [{ id: 'y', type: 'Yellow', time_sec: 100, temp_c: 160 }];
        const drafts = [{ index: 0, type: 'Yellow', time: '1:40', temp: '165', edited: 'temp' as const }];
        const res = applyEventDrafts(yellow, drafts, 'C', curve);
        if (!res.ok) throw new Error('expected ok');
        expect(res.events).toEqual([{ id: 'y', type: 'Yellow', time_sec: 105, temp_c: 165 }]);
        expect(liveReading('Yellow', 100, 160, { tempC: 165 })).toEqual({ timeSec: 105, tempC: 165 });

        const clamped = applyEventDrafts(stored, edited('End', { time: '12:00', edited: 'time' }), 'C', curve);
        if (!clamped.ok) throw new Error('expected ok');
        const end = (clamped.events as typeof stored).find((event) => event.type === 'End');
        expect(end).toMatchObject({ time_sec: 600, temp_c: 210 });
        expect(liveReading('End', 640, null, { timeSec: 720 })).toEqual({ timeSec: 600, tempC: 210 });
        expect(
            recordSummary(
                { events: stored, duration_seconds: 641, drop_temp_celsius: 210, charge_temp_celsius: 198 },
                clamped.events,
            ).durationSeconds,
        ).toBe(600);
        expect((clamped.events as typeof stored)[5]).toBe(stored[5]);
    });

    it('shows the linked field while typing and leaves Charge and Drop fixed', () => {
        const fc = toEventDrafts(stored, 'C').find((row) => row.type === 'FC Start');
        if (!fc) throw new Error('missing FC');
        expect(linkEventDraft(fc, 'time', '7:50', curve, 'C').draft).toMatchObject({
            time: '7:50',
            temp: '190',
            edited: 'time',
        });
        expect(linkEventDraft(fc, 'temp', '193', curve, 'C').draft).toMatchObject({ time: '7:55', temp: '193' });
        expect(linkEventDraft(fc, 'temp', '50', curve, 'C')).toMatchObject({
            draft: { time: '8:00', temp: '50' },
            error: 'temp',
        });
        expect(linkEventDraft(fc, 'time', '7:5', curve, 'C').draft.temp).toBe('196');
        const padded = { ...fc, temp: '193' };
        expect(linkEventDraft(padded, 'time', '08:00', curve, 'C')).toEqual({ draft: padded, error: null });
        const typed = [{ id: 'f', type: 'FC Start', time_sec: 480, temp_c: 193 }];
        const paddedDraft = [{ index: 0, type: 'FC Start', time: '08:00', temp: '193', edited: 'time' as const }];
        expect(applyEventDrafts(typed, paddedDraft, 'C', curve)).toMatchObject({ ok: true, changed: false });
        expect(linkEventDraft(padded, 'temp', '193.0', curve, 'C').draft).toBe(padded);
        const retyped = linkEventDraft({ ...padded, temp: '19', edited: 'temp' }, 'temp', '193', curve, 'C', {
            time: padded.time,
            temp: '193',
        });
        expect(retyped).toEqual({ draft: padded, error: null });
        expect(
            applyEventDrafts(
                typed,
                [{ index: 0, type: 'FC Start', time: '8:00', temp: '193.0', edited: 'temp' }],
                'C',
                curve,
            ),
        ).toMatchObject({ ok: true, changed: false });
        const fixed = applyEventDrafts(
            stored,
            edited('Charge', { time: '1:00', temp: '100', edited: 'time' }).map((row) =>
                row.type === 'Drop' ? { ...row, time: '12:00', temp: '180', edited: 'temp' as const } : row,
            ),
            'C',
            curve,
        );
        expect(fixed).toMatchObject({ ok: true, changed: false });
    });

    it('fills a new mark from the curve and does not link when no samples exist', () => {
        const missingFc = stored.filter((event) => event.type !== 'FC Start');
        const res = applyEventDrafts(
            missingFc,
            [...toEventDrafts(missingFc, 'C'), { index: -1, type: 'FC Start', time: '7:50', temp: '', edited: 'time' }],
            'C',
            curve,
        );
        if (!res.ok) throw new Error('expected ok');
        const fc = (res.events as Array<{ type: string; time_sec: number; temp_c: number | null }>).find(
            (event) => event.type === 'FC Start',
        );
        expect(fc).toMatchObject({ time_sec: 470, temp_c: 190.04 });
        expect((res.events as typeof stored).find((event) => event.type === 'Note')).toBe(stored[1]);

        const independent = applyEventDrafts(stored, edited('FC Start', { time: '7:50' }), 'C', null);
        if (!independent.ok) throw new Error('expected ok');
        expect((independent.events as typeof stored)[3]).toMatchObject({ time_sec: 470, temp_c: 196 });
    });
});
