const TIME_RE = /^(\d{1,3}):([0-5]?\d|60)$/;
const MINUTES_RE = /^\d{0,3}$/;

export type TimeEditKind = 'insert' | 'backspace' | 'delete';

export type TimeEdit = {
    value: string;
    caret: number;
    /** 콜론을 지워 분 두 자리로 돌아온 뒤, 다음 숫자는 초가 아니라 분이다. */
    suppress: boolean;
};

const clampIndex = (value: string, index: number) => Math.max(0, Math.min(index, value.length));

/** 입력 중 부분 시각. 초는 비거나 한 자리, 00–59, 60만. */
export const isPartialTime = (value: string): boolean => {
    const colon = value.indexOf(':');
    if (colon < 0) return MINUTES_RE.test(value);
    if (value.includes(':', colon + 1)) return false;
    const minutes = value.slice(0, colon);
    const seconds = value.slice(colon + 1);
    if (!MINUTES_RE.test(minutes)) return false;
    if (seconds === '' || seconds === '60') return true;
    if (seconds.length === 1) return /^\d$/.test(seconds);
    return seconds.length === 2 && /^[0-5]\d$/.test(seconds);
};

const finishTimeEdit = (value: string, caret: number, suppress: boolean): TimeEdit => ({
    value,
    caret: clampIndex(value, caret),
    suppress: suppress && /^\d{2}$/.test(value),
});

const spliceTime = (prev: string, start: number, end: number, suppress: boolean): TimeEdit => {
    const next = prev.slice(0, start) + prev.slice(end);
    if (!isPartialTime(next)) return finishTimeEdit(prev, end, suppress);
    return finishTimeEdit(next, start, /^\d{2}$/.test(next));
};

const deleteTime = (
    prev: string,
    start: number,
    end: number,
    kind: 'backspace' | 'delete',
    suppress: boolean,
): TimeEdit => {
    if (start !== end) return spliceTime(prev, start, end, suppress);
    if (kind === 'backspace') {
        if (start === 0) return finishTimeEdit(prev, 0, false);
        return spliceTime(prev, start - 1, end, suppress);
    }
    if (start >= prev.length) return finishTimeEdit(prev, start, suppress);
    return spliceTime(prev, start, start + 1, suppress);
};

const insertColon = (value: string, caret: number): TimeEdit | null => {
    if (value.includes(':')) return null;
    const before = value.slice(0, caret);
    if (!/^\d{1,3}$/.test(before)) return null;
    const next = `${before}:${value.slice(caret)}`;
    if (!isPartialTime(next)) return null;
    return { value: next, caret: before.length + 1, suppress: false };
};

const insertDigit = (value: string, caret: number, ch: string, suppress: boolean): TimeEdit | null => {
    const atEnd = caret === value.length;
    const minutesOnly = !value.includes(':');
    if (suppress && atEnd && /^\d{2}$/.test(value)) {
        return { value: value + ch, caret: value.length + 1, suppress: false };
    }
    if (minutesOnly && atEnd && /^\d$/.test(value)) {
        const minutes = value + ch;
        return { value: `${minutes}:`, caret: minutes.length + 1, suppress: false };
    }
    if (minutesOnly && atEnd && /^\d{2,3}$/.test(value)) {
        const next = `${value}:${ch}`;
        if (!isPartialTime(next)) return null;
        return { value: next, caret: next.length, suppress: false };
    }
    const next = value.slice(0, caret) + ch + value.slice(caret);
    if (!isPartialTime(next)) return null;
    return { value: next, caret: caret + 1, suppress: false };
};

const insertTimeChar = (value: string, caret: number, ch: string, suppress: boolean): TimeEdit | null => {
    if (ch === ':') return insertColon(value, caret);
    if (!/^\d$/.test(ch)) return null;
    return insertDigit(value, caret, ch, suppress);
};

const insertTimeText = (prev: string, start: number, end: number, text: string, suppress: boolean): TimeEdit => {
    const raw = text.replace(/[^\d:]/g, '');
    if (!raw) return finishTimeEdit(prev, start, suppress && start === end);
    let value = prev.slice(0, start) + prev.slice(end);
    let caret = start;
    let nextSuppress = start === end && suppress;
    for (const ch of raw) {
        const step = insertTimeChar(value, caret, ch, nextSuppress);
        if (!step) continue;
        value = step.value;
        caret = step.caret;
        nextSuppress = step.suppress;
    }
    return finishTimeEdit(value, caret, nextSuppress);
};

/** 분 두 자리가 차면 커서가 콜론 뒤로 넘어간다. `1234` → `12:34`. */
export const applyTimeEdit = (
    prev: string,
    start: number,
    end: number,
    text: string,
    kind: TimeEditKind,
    suppress = false,
): TimeEdit => {
    const from = clampIndex(prev, start);
    const to = clampIndex(prev, Math.max(from, end));
    if (kind !== 'insert') return deleteTime(prev, from, to, kind, suppress);
    return insertTimeText(prev, from, to, text, suppress);
};

export const parseEditTime = (value: string): number | null => {
    const trimmed = value.trim();
    const match = TIME_RE.exec(trimmed);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
};
