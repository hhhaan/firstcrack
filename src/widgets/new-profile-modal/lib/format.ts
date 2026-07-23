export const fmtDuration = (sec: number | null): string => {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

export const fmtDate = (iso: string | null): string => {
    if (!iso) return '—';
    return iso.slice(0, 10);
};
