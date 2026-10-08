/** 분, 또는 `분:` / `분:초`. 초가 없으면 0. 초가 한 자리면 십 초다. */
const SOFT_TIME_RE = /^(\d{1,3})(?::([0-5]?\d|60)?)?$/;
const MINUTES_RE = /^\d{0,3}$/;

export type TimeEditKind = 'insert' | 'backspace' | 'delete';

export type TimeEdit = {
    value: string;
    caret: number;
    /** 콜론을 지워 분 두 자리로 돌아온 뒤, 다음 숫자는 초가 아니라 분이다. */
    suppress: boolean;
    /** 초의 십 자리만 들어온 상태. 다음 숫자는 일 초다. */
    secondsOpen: boolean;
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

const finishTimeEdit = (value: string, caret: number, suppress: boolean, secondsOpen = false): TimeEdit => ({
    value,
    caret: clampIndex(value, caret),
    suppress: suppress && /^\d{2}$/.test(value),
    secondsOpen,
});

const atEnd = (value: string, suppress: boolean, secondsOpen: boolean): TimeEdit =>
    finishTimeEdit(value, value.length, suppress, secondsOpen);

/** 초의 첫 숫자. 0–5는 십 초(`3` → `30`), 6은 `60`만 된다. */
const secondsTens = (digit: string): string | null => {
    const n = Number(digit);
    if (n <= 5) return `${digit}0`;
    if (n === 6) return '60';
    return null;
};

const digitAtEnd = (value: string, digit: string, suppress: boolean, secondsOpen: boolean): TimeEdit | null => {
    if (suppress && /^\d{2}$/.test(value)) return atEnd(value + digit, false, false);
    if (/^\d$/.test(value)) return atEnd(`${value}${digit}:00`, false, false);
    if (/^\d{2,3}$/.test(value)) {
        const tens = secondsTens(digit);
        return tens ? atEnd(`${value}:${tens}`, false, tens !== '60') : null;
    }
    const clock = /^(\d{1,3}):(\d{2})$/.exec(value);
    if (!clock) return null;
    const minutes = clock[1];
    const seconds = clock[2];
    if (!secondsOpen && seconds === '00') {
        const tens = secondsTens(digit);
        return tens ? atEnd(`${minutes}:${tens}`, false, tens !== '60') : null;
    }
    if (!secondsOpen) return null;
    const units = Number(`${seconds[0]}${digit}`);
    if (units > 60) return null;
    return atEnd(`${minutes}:${seconds[0]}${digit}`, false, false);
};

const backspaceAtEnd = (value: string, secondsOpen: boolean): TimeEdit => {
    const clock = /^(\d{1,3}):(\d{2})$/.exec(value);
    if (!clock) return atEnd(value.slice(0, -1), false, false);
    if (secondsOpen || clock[2] === '60') return atEnd(`${clock[1]}:00`, false, false);
    if (clock[2] === '00') return atEnd(clock[1], clock[1].length === 2, false);
    return atEnd(`${clock[1]}:${clock[2][0]}0`, false, true);
};

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
    if (value.slice(caret) === '') return atEnd(`${before}:00`, false, false);
    const next = `${before}:${value.slice(caret)}`;
    if (!isPartialTime(next)) return null;
    return finishTimeEdit(next, before.length + 1, false);
};

const insertDigit = (
    value: string,
    caret: number,
    ch: string,
    suppress: boolean,
    secondsOpen: boolean,
): TimeEdit | null => {
    if (caret === value.length) {
        const stepped = digitAtEnd(value, ch, suppress, secondsOpen);
        if (stepped) return stepped;
        if (/^\d{1,3}:\d{2}$/.test(value)) return null;
    }
    const next = value.slice(0, caret) + ch + value.slice(caret);
    if (!isPartialTime(next)) return null;
    return finishTimeEdit(next, caret + 1, false);
};

const insertTimeChar = (
    value: string,
    caret: number,
    ch: string,
    suppress: boolean,
    secondsOpen: boolean,
): TimeEdit | null => {
    if (ch === ':') return insertColon(value, caret);
    if (!/^\d$/.test(ch)) return null;
    return insertDigit(value, caret, ch, suppress, secondsOpen);
};

const insertTimeText = (
    prev: string,
    start: number,
    end: number,
    text: string,
    suppress: boolean,
    secondsOpen: boolean,
): TimeEdit => {
    const raw = text.replace(/[^\d:]/g, '');
    if (!raw) return finishTimeEdit(prev, start, suppress && start === end);
    let value = prev.slice(0, start) + prev.slice(end);
    let caret = start;
    let nextSuppress = start === end && suppress;
    let open = start === end && secondsOpen;
    for (const ch of raw) {
        const step = insertTimeChar(value, caret, ch, nextSuppress, open);
        if (!step) continue;
        value = step.value;
        caret = step.caret;
        nextSuppress = step.suppress;
        open = step.secondsOpen;
    }
    return finishTimeEdit(value, caret, nextSuppress, open);
};

/** 분 두 자리가 차면 `mm:00`이 되고 커서는 끝이다. 초의 첫 숫자는 십 초다. `1234` → `12:34`. */
export const applyTimeEdit = (
    prev: string,
    start: number,
    end: number,
    text: string,
    kind: TimeEditKind,
    suppress = false,
    secondsOpen = false,
): TimeEdit => {
    const from = clampIndex(prev, start);
    const to = clampIndex(prev, Math.max(from, end));
    if (kind === 'backspace' && from === to && from === prev.length) return backspaceAtEnd(prev, secondsOpen);
    if (kind !== 'insert') return deleteTime(prev, from, to, kind, suppress);
    const replacing = from !== to;
    return insertTimeText(prev, from, to, text, replacing ? false : suppress, replacing ? false : secondsOpen);
};

/** 아직 초가 없는 분은 `m:00`으로 맞춘다. 포커스를 벗어날 때 쓴다. */
export const commitEditTime = (value: string): string => {
    const minutes = /^(\d{1,3}):?$/.exec(value.trim());
    return minutes ? `${Number(minutes[1])}:00` : value;
};

export const parseEditTime = (value: string): number | null => {
    const match = SOFT_TIME_RE.exec(value.trim());
    if (!match) return null;
    const raw = match[2];
    const seconds = raw == null || raw === '' ? 0 : raw.length === 1 ? Number(raw) * 10 : Number(raw);
    if (seconds > 60) return null;
    return Number(match[1]) * 60 + seconds;
};
