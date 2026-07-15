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

export type ScaV1Key = (typeof SCA_V1_KEYS)[number];
export type ScaV1Scores = Record<ScaV1Key, number>;

export const SCA_V1_BASE = 36;
export const DEFECT_WEIGHT = 2;
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
export const SCORE_STEP = 0.25;

export function totalScoreScaV1(scores: Partial<ScaV1Scores>, defects: number): number {
    const sum = SCA_V1_KEYS.reduce((acc, key) => acc + (scores[key] ?? 0), 0);
    return SCA_V1_BASE + sum - Math.max(0, defects) * DEFECT_WEIGHT;
}

export function isValidScoreStep(value: number): boolean {
    if (!Number.isFinite(value) || value < SCORE_MIN || value > SCORE_MAX) return false;
    // 0.25 steps: value * 4 is integer (float-safe via rounding)
    return Math.abs(value * 4 - Math.round(value * 4)) < 1e-9;
}

export function parseScaV1Scores(input: unknown): ScaV1Scores {
    if (!input || typeof input !== 'object') {
        throw new Error('scores must be an object');
    }
    const obj = input as Record<string, unknown>;
    const out = {} as ScaV1Scores;
    for (const key of SCA_V1_KEYS) {
        const v = obj[key];
        if (typeof v !== 'number' || !isValidScoreStep(v)) {
            throw new Error(`invalid score: ${key}`);
        }
        out[key] = v;
    }
    return out;
}

export function defaultScaV1Scores(fill = 6): ScaV1Scores {
    return Object.fromEntries(SCA_V1_KEYS.map((k) => [k, fill])) as ScaV1Scores;
}
