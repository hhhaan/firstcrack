/** 분, 또는 `분:` / `분:초`. 초가 없으면 0. 초 한 자리는 그대로 초다. */
const SOFT_TIME_RE = /^(\d{1,3})(?::([0-5]?\d|60)?)?$/;
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

/**
 * 화면에 빈 초를 0으로 채운다. 커서는 다음 숫자가 이어질 자리에 둔다.
 * `5` → `5|:00`, `12:` → `12:|00`, `12:3` → `12:0|3`.
 * 콜론을 지운 두 자리 분(`suppress`)은 그대로 둔다.
 */
const showSeconds = (value: string, caret: number, suppress: boolean): { value: string; caret: number } => {
    if (suppress && /^\d{2}$/.test(value)) return { value, caret };
    if (/^\d{1,3}$/.test(value)) return { value: `${value}:00`, caret };
    const match = /^(\d{1,3}):(\d{0,2})$/.exec(value);
    if (!match || match[2] === '60' || match[2].length === 2) return { value, caret };
    const minutes = match[1];
    if (match[2] === '') {
        return { value: `${minutes}:00`, caret: caret === value.length ? minutes.length + 1 : caret };
    }
    return {
        value: `${minutes}:0${match[2]}`,
        caret: caret === value.length ? minutes.length + 2 : caret,
    };
};

/** `showSeconds`가 채운 0만 걷어 내어 다음 입력을 같은 규칙으로 받는다. */
const hidePadding = (value: string, caret: number): { value: string; caret: number } => {
    const match = /^(\d{1,3}):(\d{2})$/.exec(value);
    if (!match) return { value, caret };
    const minutes = match[1];
    const seconds = match[2];
    const colon = minutes.length;
    if (seconds === '00' && caret <= colon) return { value: minutes, caret };
    if (seconds === '00' && caret === colon + 1) return { value: `${minutes}:`, caret: colon + 1 };
    if (seconds === '00' && caret === colon + 2) return { value: `${minutes}:0`, caret: colon + 2 };
    if (seconds.startsWith('0') && seconds !== '00' && caret === colon + 2) {
        return { value: `${minutes}:${seconds[1]}`, caret: colon + 2 };
    }
    return { value, caret };
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
    let value = prev;
    let from = clampIndex(prev, start);
    let to = clampIndex(prev, Math.max(from, end));
    if (from === to) {
        const bare = hidePadding(value, from);
        value = bare.value;
        from = bare.caret;
        to = from;
    }
    const edited =
        kind === 'insert'
            ? insertTimeText(value, from, to, text, suppress)
            : deleteTime(value, from, to, kind, suppress);
    const shown = showSeconds(edited.value, edited.caret, edited.suppress);
    return { ...edited, value: shown.value, caret: clampIndex(shown.value, shown.caret) };
};

export const parseEditTime = (value: string): number | null => {
    const match = SOFT_TIME_RE.exec(value.trim());
    if (!match) return null;
    const seconds = match[2] == null || match[2] === '' ? 0 : Number(match[2]);
    return Number(match[1]) * 60 + seconds;
};
