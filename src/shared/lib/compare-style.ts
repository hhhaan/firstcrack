/** Stable batch identities across selection, legends and comparison charts. */
export const COMPARE_COLORS = [
    'var(--color-compare-blue)',
    'var(--color-compare-orange)',
    'var(--color-compare-purple)',
    'var(--color-compare-teal)',
] as const;

export const COMPARE_LINE_DASHES: number[][] = [[], [10, 5], [2, 5], [10, 4, 2, 4]];
