/** `#rrggbb` for comparisons; color inputs always emit lowercase but theme resolution may vary. */
export const normalizeCurveColorHex = (hex: string): string => hex.trim().toLowerCase();

/**
 * Whether picking `hex` should persist a custom color.
 * Skips commit when it matches stored custom color or the theme fallback (stored null).
 */
export const shouldCommitCurveColor = (hex: string, stored: string | null, themeFallback?: string | null): boolean => {
    const picked = normalizeCurveColorHex(hex);
    if (stored != null && normalizeCurveColorHex(stored) === picked) return false;
    if (stored == null && themeFallback != null && normalizeCurveColorHex(themeFallback) === picked) {
        return false;
    }
    return stored !== picked;
};
