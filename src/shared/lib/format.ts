export const sanitizeDecimal = (v: string) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

/** Live elapsed clock: floor fractional seconds. 90.6 → "1:30" */
export const formatElapsed = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

/** Recorded duration: round fractional seconds; null → "—". 90.6 → "1:31" */
export const formatDuration = (seconds: number | null): string => {
    if (seconds == null) return '—';
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

export const formatDate = (iso: string | null, timeZone?: string): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
};

/** Format ISO → "YY-MM-DD" in the local calendar day (or '—' on null). */
export const formatDateShort = (iso: string | null, timeZone?: string): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    return `${year.slice(-2)}-${month}-${day}`;
};

export const formatDateTimeShort = (iso: string | null, timeZone?: string): string => {
    const date = formatDateShort(iso, timeZone);
    if (!iso || date === '—') return '—';
    const time = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(new Date(iso));
    return `${date} ${time}`;
};

export const pctChange = (current: number, previous: number): string => {
    if (previous === 0) return '—';
    const diff = ((current - previous) / previous) * 100;
    return `${diff >= 0 ? '+' : ''}${Math.round(diff)}%`;
};

export const durationDiff = (current: number, previous: number): string => {
    const diff = Math.round(current - previous);
    return `${diff >= 0 ? '+' : '-'}${formatDuration(Math.abs(diff))}`;
};
