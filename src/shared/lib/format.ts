import { i18n } from '@shared/i18n';

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

/** i18n.language → Date locale. ko stays en-US (short-month tokens; dashboard contract). */
export const localeForDate = (): string => {
    switch (i18n.language) {
        case 'zh-CN':
            return 'zh-CN';
        case 'ja':
            return 'ja-JP';
        default:
            return 'en-US';
    }
};

export const formatDate = (iso: string | Date | null | undefined): string => {
    if (!iso) return '—';
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(localeForDate(), { month: 'short', day: 'numeric' });
};

/** grams → kg string; dashboard compact weight wraps this. */
export const gramsToKg = (grams: number, digits = 2): string => (grams / 1000).toFixed(digits);

/** Format ISO → "YY-MM-DD" (or '—' on null). */
export const formatDateShort = (iso: string | null): string => {
    if (!iso) return '—';
    return iso.slice(2, 10);
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
