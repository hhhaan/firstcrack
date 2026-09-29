import { describe, expect, it } from 'vitest';
import { applyEventDrafts, recordSummary, toEventDrafts } from './record-edit';

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
