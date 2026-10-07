/** `#rrggbb` for comparisons; color inputs always emit lowercase but theme resolution may vary. */
export const normalizeCurveColorHex = (hex: string): string => hex.trim().toLowerCase();

export type CurveColorCommit = { kind: 'skip' } | { kind: 'set'; color: string | null };

/** Whether to persist, clear to theme (`null`), or ignore this pick. */
export const resolveCurveColorCommit = (
    hex: string,
    stored: string | null,
    themeFallback?: string | null,
): CurveColorCommit => {
    const picked = normalizeCurveColorHex(hex);
    const theme = themeFallback != null ? normalizeCurveColorHex(themeFallback) : null;
    const storedNorm = stored != null ? normalizeCurveColorHex(stored) : null;

    if (storedNorm === picked) return { kind: 'skip' };
    if (stored == null && theme === picked) return { kind: 'skip' };
    if (theme === picked) return { kind: 'set', color: null };
    return { kind: 'set', color: picked };
};

export const shouldCommitCurveColor = (hex: string, stored: string | null, themeFallback?: string | null): boolean =>
    resolveCurveColorCommit(hex, stored, themeFallback).kind === 'set';
