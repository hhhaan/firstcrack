/** Stable batch identities across selection, phase bars and result tables. */
export const COMPARE_COLORS = [
    'var(--color-compare-blue)',
    'var(--color-compare-orange)',
    'var(--color-compare-purple)',
    'var(--color-compare-teal)',
    'var(--color-compare-rose)',
] as const;

/** Shared SVG paths keep chart symbols and batch labels identical. */
export const COMPARE_MARKERS = [
    'M0,-4.5A4.5,4.5 0 1,1 0,4.5A4.5,4.5 0 1,1 0,-4.5Z',
    'M-4,-4H4V4H-4Z',
    'M0,-5L5,4H-5Z',
    'M0,-5L5,0L0,5L-5,0Z',
    'M-5,-1H-1V-5H1V-1H5V1H1V5H-1V1H-5Z',
] as const;
