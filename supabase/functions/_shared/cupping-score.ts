export const SCA_V1_KEYS = [
    'fragrance',
    'aroma',
    'flavor',
    'aftertaste',
    'acidity',
    'body',
    'balance',
    'overall',
] as const;

export const SCA_V1_BASE = 36;
export const DEFECT_WEIGHT = 2;

export function isValidScoreStep(value: number): boolean {
    if (!Number.isFinite(value) || value < 0 || value > 10) return false;
    return Math.abs(value * 4 - Math.round(value * 4)) < 1e-9;
}

export function parseScaV1Scores(input: unknown): Record<(typeof SCA_V1_KEYS)[number], number> {
    if (!input || typeof input !== 'object') {
        throw new Error('scores must be an object');
    }
    const obj = input as Record<string, unknown>;
    const out = {} as Record<(typeof SCA_V1_KEYS)[number], number>;
    for (const key of SCA_V1_KEYS) {
        const v = obj[key];
        if (typeof v !== 'number' || !isValidScoreStep(v)) {
            throw new Error(`invalid score: ${key}`);
        }
        out[key] = v;
    }
    return out;
}

export function totalScoreScaV1(scores: Record<string, number>, defects: number): number {
    const sum = SCA_V1_KEYS.reduce((acc, key) => acc + (scores[key] ?? 0), 0);
    return SCA_V1_BASE + sum - Math.max(0, defects) * DEFECT_WEIGHT;
}
