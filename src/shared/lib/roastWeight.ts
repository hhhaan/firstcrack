/** Default shrink factor: output ≈ 82% of green input. */
export const DEFAULT_SHRINK_FACTOR = 0.82;

export interface RoastWeights {
    outputKg: number;
    inputKg: number;
    lossRate: number;
}

export const computeRoastWeights = (weightGrams: number | null | undefined): RoastWeights => {
    const outputKg = (weightGrams ?? 0) / 1000;
    const inputKg = outputKg / DEFAULT_SHRINK_FACTOR;
    const lossRate = inputKg > 0 ? ((inputKg - outputKg) / inputKg) * 100 : 0;
    return {
        outputKg: Math.round(outputKg * 1000) / 1000,
        inputKg: Math.round(inputKg * 1000) / 1000,
        lossRate: Math.round(lossRate * 10) / 10,
    };
};
