/** 분, 또는 `분:초`. 마스크는 항상 `mm:ss` 네 칸이다. */
const SOFT_TIME_RE = /^(\d{1,3})(?::([0-5]?\d|60)?)?$/;
const MINUTES_RE = /^\d{0,3}$/;

export type TimeEditKind = 'insert' | 'backspace' | 'delete';

export type TimeEdit = {
    value: string;
    caret: number;
    /** 이 입력 세션이 칸 수를 직접 갖고 있다. 비어 있어도 기존 시각으로 되돌리지 않는다. */
    suppress: boolean;
    /** 초의 십 자리만 들어온 상태. 고정 마스크에서는 쓰지 않는다. */
    secondsOpen: boolean;
    /** 왼쪽부터 채운 숫자. `0530` → `05:30`. */
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

const caretFor = (filled: number) => [0, 1, 3, 4, 5][Math.max(0, Math.min(4, filled))] ?? 5;

const showSlots = (slots: string): TimeEdit => {
    const padded = `${slots}0000`.slice(0, 4);
    return {
        value: `${padded.slice(0, 2)}:${padded.slice(2)}`,
        caret: caretFor(slots.length),
        suppress: true,
        secondsOpen: false,
        digits: slots,
    };
};

const slotsOf = (value: string): string | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match || Number(match[2]) > 60) return null;
    return match[1].padStart(2, '0') + match[2];
};

const secondsFit = (slots: string): boolean => {
    if (slots.length <= 2) return true;
    if (slots.length === 3) return Number(slots[2]) <= 6;
    return slots.length === 4 && Number(slots.slice(2)) <= 60;
};

const filledSlots = (value: string, digits: string, owned: boolean): string => {
    if (owned) return digits;
    if (value.trim() === '') return '';
    return slotsOf(value) ?? '';
};

/** `00:00` 칸. 숫자는 왼쪽부터 채우고 커서는 다음 칸으로 간다. */
export const applyTimeEdit = (
    prev: string,
    start: number,
    end: number,
    text: string,
    kind: TimeEditKind,
    suppress = false,
    _secondsOpen = false,
    digits = '',
): TimeEdit => {
    const from = clampIndex(prev, start);
    const to = clampIndex(prev, Math.max(from, end));
    const replacing = from !== to;
    let slots = replacing ? '' : filledSlots(prev, digits, suppress);
    const keep = (): TimeEdit => ({
        value: prev,
        caret: from,
        suppress,
        secondsOpen: false,
        digits: suppress ? digits : '',
    });

    if (kind !== 'insert') {
        if (replacing && from === 0 && to >= prev.length) return showSlots('');
        if (!replacing && kind === 'backspace' && slots.length > 0 && from === caretFor(slots.length)) {
            return showSlots(slots.slice(0, -1));
        }
        return keep();
    }

    const pasted = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (pasted) {
        const minutes = pasted[1].padStart(2, '0').slice(-2);
        let next = minutes;
        for (const ch of pasted[2]) {
            const withSecond = (next.length === 2 ? minutes : next) + ch;
            if (!secondsFit(withSecond)) break;
            next = withSecond;
        }
        return showSlots(next.length >= 2 ? next : minutes);
    }

    const before = slots;
    for (const ch of text.replace(/[^\d]/g, '')) {
        const next = slots + ch;
        if (next.length > 4 || !secondsFit(next)) continue;
        slots = next;
    }
    return slots === before ? keep() : showSlots(slots);
};

/** 아직 초가 없는 분은 `mm:00`으로 맞춘다. 포커스를 벗어날 때 쓴다. */
export const commitEditTime = (value: string): string => {
    const slots = slotsOf(value);
    if (slots) return showSlots(slots).value;
    const minutes = /^(\d{1,3}):?$/.exec(value.trim());
    if (!minutes) return value;
    return showSlots(String(Number(minutes[1])).padStart(2, '0').slice(-2)).value;
};

export const parseEditTime = (value: string): number | null => {
    const match = SOFT_TIME_RE.exec(value.trim());
    if (!match) return null;
    const raw = match[2];
    const seconds = raw == null || raw === '' ? 0 : raw.length === 1 ? Number(raw) * 10 : Number(raw);
    if (seconds > 60) return null;
    return Number(match[1]) * 60 + seconds;
};
