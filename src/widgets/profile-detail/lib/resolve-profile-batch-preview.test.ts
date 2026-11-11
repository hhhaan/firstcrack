import type { ProfileReferenceBatch, RoastProfileWithSource } from '@entities/roast-profile';
import { describe, expect, it } from 'vitest';
import { profilePreviewBatches, profilePreviewOrphanSource, profilePreviewReference } from './profile-preview-fixtures';
import { resolveProfileBatchPreview } from './resolve-profile-batch-preview';

describe('resolveProfileBatchPreview', () => {
    it('uses source_session tsv when the profile source is not in referenceBatches', () => {
        const resolved = resolveProfileBatchPreview(
            profilePreviewOrphanSource,
            'picked-session',
            profilePreviewBatches,
            false,
        );
        expect(resolved.tsvPath).toBe('curves/picked.tsv');
        expect(resolved.awaitingBatchMeta).toBe(false);
        expect(resolved.chartProfile.source_session).toMatchObject({ tsv_path: 'curves/picked.tsv' });
    });

    it('stays loading while batches load for a list-only preview target', () => {
        const resolved = resolveProfileBatchPreview(profilePreviewOrphanSource, 's4', [], true);
        expect(resolved.tsvPath).toBeNull();
        expect(resolved.awaitingBatchMeta).toBe(true);
    });

    it('stays loading on profile source while batches load when embedded has no tsv', () => {
        const profile = {
            ...profilePreviewOrphanSource,
            source_session_id: 's3',
            source_session: { tsv_path: null, events: null },
        } as RoastProfileWithSource;
        const resolved = resolveProfileBatchPreview(profile, 's3', [], true);
        expect(resolved.tsvPath).toBeNull();
        expect(resolved.awaitingBatchMeta).toBe(true);
    });

    it('uses reference batch tsv once batches load when embedded has no tsv', () => {
        const profile = {
            ...profilePreviewOrphanSource,
            source_session_id: 's3',
            source_session: { tsv_path: null, events: null },
        } as RoastProfileWithSource;
        const resolved = resolveProfileBatchPreview(profile, 's3', profilePreviewBatches, false);
        expect(resolved.tsvPath).toBe('curves/s3.tsv');
        expect(resolved.awaitingBatchMeta).toBe(false);
    });

    it('exposes no tsv only after batches finished without a matching row', () => {
        const profile = {
            ...profilePreviewOrphanSource,
            source_session_id: 'other',
            source_session: { tsv_path: null, events: null },
        } as RoastProfileWithSource;
        const resolved = resolveProfileBatchPreview(profile, 'missing', [] as ProfileReferenceBatch[], false);
        expect(resolved.tsvPath).toBeNull();
        expect(resolved.awaitingBatchMeta).toBe(false);
    });

    it('sizes a selected log to that batch duration and keeps the profile target when the log has none', () => {
        const withDuration = profilePreviewBatches.map((batch) =>
            batch.id === 's4' ? { ...batch, duration_seconds: 400 } : batch,
        );
        const selected = resolveProfileBatchPreview(profilePreviewReference, 's4', withDuration, false);
        expect(selected.chartProfile.duration_sec).toBe(400);
        expect(selected.chartProfile.source_session).toMatchObject({ duration_seconds: 400 });

        const undated = resolveProfileBatchPreview(profilePreviewReference, 's3', profilePreviewBatches, false);
        expect(undated.chartProfile.duration_sec).toBe(600);
    });
});
