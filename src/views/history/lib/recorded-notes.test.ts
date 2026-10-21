import { describe, expect, it } from 'vitest';
import { insertRecordedNote, recordedNotes, removeRecordedNote, updateRecordedNote } from './recorded-notes';

const events = [
    { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
    { id: 'n2', type: 'Note', time_sec: 125, note: 'second', extra: 1 },
    { id: 'n1', type: 'Note', time_sec: 61, note: ' first ', gas: '3' },
    { id: 'd', type: 'Drop', time_sec: 600, temp_c: 194 },
];

describe('recorded notes', () => {
    it('lists roast-log notes in time order and keeps the comment separate from controls', () => {
        expect(recordedNotes(events)).toEqual([
            { index: 2, timeSec: 61, time: '1:01', comment: 'first', gas: '3' },
            { index: 1, timeSec: 125, time: '2:05', comment: 'second' },
        ]);
        expect(recordedNotes(null)).toEqual([]);
        expect(recordedNotes([{ id: 'b', type: 'Note', time_sec: -180, note: 'soak' }])).toEqual([
            { index: 0, timeSec: -180, time: '-3:00', comment: 'soak' },
        ]);
    });

    it('adds, edits, and deletes a note without touching the other rows', () => {
        const added = insertRecordedNote(events, 30, '  early ') as Array<Record<string, unknown>>;
        expect(added.map((row) => row.type)).toEqual(['Charge', 'Note', 'Note', 'Note', 'Drop']);
        expect(added[1]).toMatchObject({ type: 'Note', time_sec: 30, note: 'early' });
        expect(updateRecordedNote(events, 2, 90, ' renamed ')).toEqual([
            events[0],
            events[1],
            { id: 'n1', type: 'Note', time_sec: 90, note: 'renamed', gas: '3' },
            events[3],
        ]);
        expect(removeRecordedNote(events, 1)).toEqual([events[0], events[2], events[3]]);
        expect(removeRecordedNote(events, 0)).toBeNull();
        expect(updateRecordedNote(events, 0, 10, 'nope')).toBeNull();
    });
});
