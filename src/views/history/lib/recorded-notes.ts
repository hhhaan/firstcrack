import { formatSignedElapsed } from '@shared/lib/format';
import type { Json } from '@shared/types/database.types';

export type RecordedNote = {
    id: string | null;
    /** Index in the stored events array. */
    index: number;
    timeSec: number;
    time: string;
    comment: string;
    gas?: string;
    airflow?: string;
    drum?: string;
};

const rowOf = (item: unknown): Record<string, unknown> | null =>
    item != null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Notes taken on the roast log. These live on events, not `roast_sessions.notes`. */
export const recordedNotes = (raw: unknown): RecordedNote[] => {
    if (!Array.isArray(raw)) return [];
    const notes: RecordedNote[] = [];
    raw.forEach((item, index) => {
        const row = rowOf(item);
        if (!row || row.type !== 'Note') return;
        const timeSec = typeof row.time_sec === 'number' && Number.isFinite(row.time_sec) ? row.time_sec : 0;
        const gas = text(row.gas);
        const airflow = text(row.airflow);
        const drum = text(row.drum);
        notes.push({
            id: typeof row.id === 'string' && row.id ? row.id : null,
            index,
            timeSec,
            time: formatSignedElapsed(timeSec),
            comment: text(row.note),
            ...(gas ? { gas } : {}),
            ...(airflow ? { airflow } : {}),
            ...(drum ? { drum } : {}),
        });
    });
    return notes.sort((a, b) => a.timeSec - b.timeSec || a.index - b.index);
};

const insertAtTime = (list: unknown[], event: Record<string, unknown>, timeSec: number) => {
    const at = list.findIndex((item) => {
        const row = rowOf(item);
        const time = row?.time_sec;
        return typeof time === 'number' && time > timeSec;
    });
    if (at === -1) list.push(event);
    else list.splice(at, 0, event);
};

/** Insert a comment note. Other event rows stay as they are. */
export const insertRecordedNote = (raw: unknown, timeSec: number, comment: string): Json => {
    const list = Array.isArray(raw) ? [...raw] : [];
    insertAtTime(
        list,
        { id: crypto.randomUUID(), type: 'Note', time_sec: timeSec, temp_c: null, note: comment.trim() },
        timeSec,
    );
    return list as Json;
};

/** Drop one note row. Returns null when that index is not a note. */
export const removeRecordedNote = (raw: unknown, index: number): Json | null => {
    if (!Array.isArray(raw)) return null;
    const row = rowOf(raw[index]);
    if (!row || row.type !== 'Note') return null;
    return raw.filter((_, i) => i !== index) as Json;
};

/** Change one note's time and comment. Controls on that row stay. */
export const updateRecordedNote = (raw: unknown, index: number, timeSec: number, comment: string): Json | null => {
    if (!Array.isArray(raw)) return null;
    const row = rowOf(raw[index]);
    if (!row || row.type !== 'Note') return null;
    return raw.map((item, i) =>
        i === index ? { ...row, time_sec: timeSec, note: comment.trim() || null } : item,
    ) as Json;
};
