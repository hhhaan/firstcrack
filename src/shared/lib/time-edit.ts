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
    /** 콜론 없이 이어서 친 숫자. `530` → 5:30, `1234` → 12:34. */
    digits: string;
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

const finishTimeEdit = (
    value: string,
    caret: number,
    suppress: boolean,
    secondsOpen = false,
    digits = '',
): TimeEdit => ({
    value,
    caret: clampIndex(value, caret),
    suppress: suppress && /^\d{2}$/.test(value),
    secondsOpen,
    digits,
});

const atEnd = (value: string, suppress: boolean, secondsOpen: boolean, digits = ''): TimeEdit =>
    finishTimeEdit(value, value.length, suppress, secondsOpen, digits);

/** 1자리 분, 2자리 분, 3자리 `m:ss`, 4자리 `mm:ss`. 초가 60을 넘으면 거절. */
const shownFromDigits = (digits: string): TimeEdit | null => {
    if (digits.length === 0) return atEnd('', false, false, '');
    if (digits.length === 1) return atEnd(digits, false, false, digits);
    if (digits.length === 2) return atEnd(`${digits}:00`, false, false, digits);
    const split = digits.length === 3 ? 1 : digits.length === 4 ? 2 : 0;
    if (split === 0) return null;
    const seconds = Number(digits.slice(split));
    if (seconds > 60) return null;
    return atEnd(`${Number(digits.slice(0, split))}:${digits.slice(split)}`, false, false, digits);
};

/** 초의 첫 숫자. 0–5는 십 초(`3` → `30`), 6은 `60`만 된다. */
const secondsTens = (digit: string): string | null => {
    const n = Number(digit);
    if (n <= 5) return `${digit}0`;
    if (n === 6) return '60';
    return null;
};

const digitAtEnd = (
    value: string,
    digit: string,
    suppress: boolean,
    secondsOpen: boolean,
    digits: string,
): TimeEdit | null => {
    const bare = value === '' || /^\d$/.test(value) ? value : null;
    const run = digits.length > 0 ? digits : bare;
    if (run != null && run.length < 4) {
        const next = run + digit;
        const shown = shownFromDigits(next);
        if (shown) return shown;
        // `164`는 1:64가 아니므로 16분의 초로 넘기고, 다음 숫자로 16:41을 만든다.
        if (next.length === 3) {
            const tens = secondsTens(digit);
            if (!tens) return null;
            return atEnd(`${next.slice(0, 2)}:${tens}`, false, tens !== '60', next);
        }
        return null;
    }
    if (suppress && /^\d{2}$/.test(value)) return atEnd(value + digit, false, false);
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

const backspaceAtEnd = (value: string, secondsOpen: boolean, digits: string): TimeEdit => {
    if (digits.length > 0) return shownFromDigits(digits.slice(0, -1)) ?? atEnd('', false, false, '');
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

const insertColon = (value: string, caret: number, digits: string): TimeEdit | null => {
    if (digits.length > 0 && caret === value.length && /:00$/.test(value)) return atEnd(value, false, false, '');
    if (value.includes(':')) return null;
    const before = value.slice(0, caret);
    if (!/^\d{1,3}$/.test(before)) return null;
    if (value.slice(caret) === '') return atEnd(`${Number(before)}:00`, false, false, '');
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
    digits: string,
): TimeEdit | null => {
    if (caret === value.length) {
        const stepped = digitAtEnd(value, ch, suppress, secondsOpen, digits);
        if (stepped) return stepped;
        if (/^\d{1,3}:\d{2}$/.test(value) || digits.length > 0) return null;
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
    digits: string,
): TimeEdit | null => {
    if (ch === ':') return insertColon(value, caret, digits);
    if (!/^\d$/.test(ch)) return null;
    return insertDigit(value, caret, ch, suppress, secondsOpen, digits);
};

const insertTimeText = (
    prev: string,
    start: number,
    end: number,
    text: string,
    suppress: boolean,
    secondsOpen: boolean,
    digits: string,
): TimeEdit => {
    const raw = text.replace(/[^\d:]/g, '');
    if (!raw) return finishTimeEdit(prev, start, suppress && start === end, false, start === end ? digits : '');
    let value = prev.slice(0, start) + prev.slice(end);
    let caret = start;
    let nextSuppress = start === end && suppress;
    let open = start === end && secondsOpen;
    let nextDigits = start === end ? digits : '';
    for (const ch of raw) {
        const step = insertTimeChar(value, caret, ch, nextSuppress, open, nextDigits);
        if (!step) continue;
        value = step.value;
        caret = step.caret;
        nextSuppress = step.suppress;
        open = step.secondsOpen;
        nextDigits = step.digits;
    }
    return finishTimeEdit(value, caret, nextSuppress, open, nextDigits);
};

/** `12` → `12:00`, `530` → `5:30`, `1234` → `12:34`. 커서는 끝이다. */
export const applyTimeEdit = (
    prev: string,
    start: number,
    end: number,
    text: string,
    kind: TimeEditKind,
    suppress = false,
    secondsOpen = false,
    digits = '',
): TimeEdit => {
    const from = clampIndex(prev, start);
    const to = clampIndex(prev, Math.max(from, end));
    if (kind === 'backspace' && from === to && from === prev.length) return backspaceAtEnd(prev, secondsOpen, digits);
    if (kind !== 'insert') return deleteTime(prev, from, to, kind, suppress);
    const replacing = from !== to;
    return insertTimeText(
        prev,
        from,
        to,
        text,
        replacing ? false : suppress,
        replacing ? false : secondsOpen,
        replacing ? '' : digits,
    );
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
