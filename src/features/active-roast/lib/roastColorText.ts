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

/** Empty is unset; invalid legacy text stays readable without inventing a measurement. */
export const parseRoastColorReadings = (raw: string | null | undefined): number[] | null => {
    const text = normalizeRoastColorText(raw);
    if (text == null) return [];
    const parts = text.split(',').map((part) => part.trim());
    if (parts.some((part) => !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(part))) return null;
    const values = parts.map(Number);
    return values.every(Number.isFinite) ? values : null;
};

export const roastColorAverage = (raw: string | null | undefined): number | null => {
    const values = parseRoastColorReadings(raw);
    if (!values?.length) return null;
    return values.reduce((average, value) => average + value / values.length, 0);
};

/** Display derives the average; the original readings remain the stored value. */
export const roastColorDisplay = (raw: string | null | undefined): string => {
    const average = roastColorAverage(raw);
    return average == null ? (normalizeRoastColorText(raw) ?? '—') : average.toFixed(2);
};
