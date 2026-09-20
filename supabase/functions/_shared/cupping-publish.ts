import { normalizeDescriptors } from './cupping-score.ts';

export const MAX_PUBLISH_SAMPLES = 40;

export function normalizeCuppedBy(raw: unknown): string {
    const s = typeof raw === 'string' ? raw.trim() : '';
    return (s || 'Anonymous').slice(0, 80);
}

export type RawPublishSample = {
    sampleId: string;
    scores: unknown;
    defects: number;
    notes: string | null;
    descriptors: string[];
};

export function parsePublishSamples(input: unknown): RawPublishSample[] {
    if (!Array.isArray(input) || input.length < 1) throw new Error('samples required');
    if (input.length > MAX_PUBLISH_SAMPLES) throw new Error('too many samples');
    const seen = new Set<string>();
    const out: RawPublishSample[] = [];
    for (const item of input) {
        if (!item || typeof item !== 'object') throw new Error('invalid sample');
        const row = item as Record<string, unknown>;
        const sampleId = typeof row.sampleId === 'string' ? row.sampleId.trim() : '';
        if (!sampleId) throw new Error('sampleId required');
        if (seen.has(sampleId)) throw new Error('duplicate sample');
        seen.add(sampleId);
        const defects =
            typeof row.defects === 'number' && Number.isInteger(row.defects) && row.defects >= 0
                ? row.defects
                : 0;
        const notes = typeof row.notes === 'string' ? row.notes.slice(0, 2000) : null;
        out.push({
            sampleId,
            scores: row.scores,
            defects,
            notes,
            descriptors: normalizeDescriptors(row.descriptors),
        });
    }
    return out;
}

export function parseInviteAction(raw: unknown): 'claim' | 'publish' | 'legacy' {
    if (raw == null || raw === '') return 'legacy';
    if (raw === 'claim' || raw === 'publish' || raw === 'legacy') return raw;
    throw new Error('invalid action');
}
