/** Fallback shrink factor when neither output weight nor roast level is known. */
export const DEFAULT_SHRINK_FACTOR = 0.82;

/** Typical output/green ratio per roast level — darker roast, more loss. Estimate only. */
const SHRINK_BY_LEVEL: Record<string, number> = {
    Light: 0.88,
    'Medium-Light': 0.865,
    Medium: 0.85,
    'Medium-Dark': 0.835,
    Dark: 0.82,
};

export const shrinkFactorForLevel = (roastLevel: string | null | undefined): number =>
    SHRINK_BY_LEVEL[roastLevel ?? ''] ?? DEFAULT_SHRINK_FACTOR;

export interface RoastWeights {
    outputKg: number;
    inputKg: number;
    lossRate: number;
    /** false when outputKg was estimated via DEFAULT_SHRINK_FACTOR instead of measured. */
    measured: boolean;
}

const round3 = (kg: number) => Math.round(kg * 1000) / 1000;

/**
 * @param greenGrams  roast_sessions.weight_grams — green input (same field that drives stock deduction)
 * @param outputGrams roast_sessions.output_weight_grams — measured roasted output; null on sessions saved before capture existed
 * @param roastLevel  roast_sessions.roast_level — refines the estimate when output is unmeasured
 */
export const computeRoastWeights = (
    greenGrams: number | null | undefined,
    outputGrams?: number | null,
    roastLevel?: string | null,
): RoastWeights => {
    const inputKg = (greenGrams ?? 0) / 1000;
    const measured = outputGrams !== null && outputGrams !== undefined && outputGrams > 0;
    const outputKg = measured ? outputGrams / 1000 : inputKg * shrinkFactorForLevel(roastLevel);
    const lossRate = inputKg > 0 ? ((inputKg - outputKg) / inputKg) * 100 : 0;

    return {
        outputKg: round3(outputKg),
        inputKg: round3(inputKg),
        lossRate: Math.round(lossRate * 10) / 10,
        measured,
    };
};
