export const fmtDate = (iso: string | null): string => {
    if (!iso) return '—';
    return iso.slice(0, 10);
};
