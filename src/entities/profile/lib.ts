/** Trimmed display name, or null when empty / whitespace-only. */
export function normalizeDisplayName(raw: string): string | null {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;
