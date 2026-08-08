export type BeanStatus = 'Good' | 'Low' | 'Out';

export const getStatus = (effectiveGrams: number, lowStockThresholdGrams: number): BeanStatus => {
    if (effectiveGrams <= 0) return 'Out';
    if (effectiveGrams <= lowStockThresholdGrams) return 'Low';
    return 'Good';
};

/** Stock bar fill 0–100. Negative stock must not produce a negative % width (invalid CSS → full bar). */
export const stockLevelPct = (currentGrams: number, capacityGrams: number): number => {
    if (capacityGrams <= 0) return 0;
    return Math.max(0, Math.min(100, (currentGrams / capacityGrams) * 100));
};

export const stockBarClass: Record<BeanStatus, string> = {
    Good: 'bg-palette-green',
    Low: 'bg-palette-yellow',
    Out: 'bg-palette-violet',
};

export const statusConfig: Record<BeanStatus, { color: string; bg: string; label: string }> = {
    Good: {
        color: 'var(--color-palette-green)',
        bg: 'color-mix(in srgb, var(--color-palette-green) 15%, transparent)',
        label: 'In Stock',
    },
    Low: {
        color: 'var(--color-palette-yellow)',
        bg: 'color-mix(in srgb, var(--color-palette-yellow) 20%, transparent)',
        label: 'Low Stock',
    },
    Out: {
        color: 'var(--color-palette-violet)',
        bg: 'color-mix(in srgb, var(--color-palette-violet) 12%, transparent)',
        label: 'Out of Stock',
    },
};

export const processColor: Record<string, { color: string; bg: string }> = {
    Natural: {
        color: 'var(--color-palette-lavender)',
        bg: 'color-mix(in srgb, var(--color-palette-lavender) 12%, transparent)',
    },
    Washed: {
        color: 'var(--color-palette-blue)',
        bg: 'color-mix(in srgb, var(--color-palette-blue) 12%, transparent)',
    },
    Honey: {
        color: 'var(--color-palette-yellow)',
        bg: 'color-mix(in srgb, var(--color-palette-yellow) 20%, transparent)',
    },
    Anaerobic: {
        color: 'var(--color-palette-purple)',
        bg: 'color-mix(in srgb, var(--color-palette-purple) 12%, transparent)',
    },
    Experimental: {
        color: 'var(--color-palette-teal)',
        bg: 'color-mix(in srgb, var(--color-palette-teal) 12%, transparent)',
    },
};
