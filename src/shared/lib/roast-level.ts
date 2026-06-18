export const levelColor: Record<string, string> = {
    Light: 'var(--color-palette-yellow)',
    'Medium-Light': 'var(--color-palette-teal)',
    Medium: 'var(--color-palette-blue)',
    'Medium-Dark': 'var(--color-palette-purple)',
    Dark: 'var(--color-palette-violet)',
};

export const levelBg: Record<string, string> = {
    Light: 'color-mix(in srgb, var(--color-palette-yellow) 20%, transparent)',
    'Medium-Light': 'color-mix(in srgb, var(--color-palette-teal) 15%, transparent)',
    Medium: 'color-mix(in srgb, var(--color-palette-blue) 12%, transparent)',
    'Medium-Dark': 'color-mix(in srgb, var(--color-palette-purple) 12%, transparent)',
    Dark: 'color-mix(in srgb, var(--color-palette-violet) 12%, transparent)',
};
