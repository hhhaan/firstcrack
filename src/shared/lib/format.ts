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

export const formatDateShort = (iso: string | null): string => {
    if (!iso) return '—';
    return iso.slice(5, 10);
};

export const pctChange = (current: number, previous: number): string => {
    if (previous === 0) return current > 0 ? '+∞%' : '0%';
    const diff = ((current - previous) / previous) * 100;
    return `${diff >= 0 ? '+' : ''}${Math.round(diff)}%`;
};

export const durationDiff = (current: number, previous: number): string => {
    const diff = Math.round(current - previous);
    return `${diff >= 0 ? '+' : '-'}${formatDuration(Math.abs(diff))}`;
};