/** Matches {@link roastSummarySchema} beanLabel cap — enough for multi-reading Agtron notes. */
export const ROAST_COLOR_MAX_LENGTH = 120;

/** HTML `maxLength` — trimmed value capped at {@link ROAST_COLOR_MAX_LENGTH}; extra space allowed. */
export const ROAST_COLOR_INPUT_MAX_LENGTH = ROAST_COLOR_MAX_LENGTH + 32;

/** Trim surrounding whitespace only; blank → null. Never parse or reformat. */
export const normalizeRoastColorText = (raw: string | null | undefined): string | null => {
    if (raw == null) return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
};

/** Length cap applies to trimmed text; inputs may include extra surrounding spaces. */
export const isRoastColorTooLong = (raw: string | null | undefined): boolean =>
    (normalizeRoastColorText(raw)?.length ?? 0) > ROAST_COLOR_MAX_LENGTH;
