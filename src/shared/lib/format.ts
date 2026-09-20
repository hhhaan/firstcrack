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
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

export const formatDate = (iso: string | null): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** Format ISO → "YY-MM-DD" in the local calendar day (or '—' on null). */
export const formatDateShort = (iso: string | null): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
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
