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
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
export const SCORE_STEP = 0.25;

export function isValidScoreStep(value: number): boolean {
    if (!Number.isFinite(value) || value < SCORE_MIN || value > SCORE_MAX) return false;
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

/** lowercase, ≤40 chars, max 20 unique tags — shared with submit-cupping. */
export function normalizeDescriptors(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of raw) {
        if (typeof x !== 'string') continue;
        const tag = x.trim().toLowerCase().slice(0, 40);
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        out.push(tag);
        if (out.length >= 20) break;
    }
    return out;
}
