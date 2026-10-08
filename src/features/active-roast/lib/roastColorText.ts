/** Matches {@link roastSummarySchema} beanLabel cap — enough for multi-reading Agtron notes. */
export const ROAST_COLOR_MAX_LENGTH = 120;

/** Trim surrounding whitespace only; blank → null. Never parse or reformat. */
export const normalizeRoastColorText = (raw: string | null | undefined): string | null => {
    if (raw == null) return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
};
