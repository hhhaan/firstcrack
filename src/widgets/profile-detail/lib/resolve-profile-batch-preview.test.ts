import type { ProfileReferenceBatch, RoastProfileWithSource } from '@entities/roast-profile';
import { describe, expect, it } from 'vitest';
import { profilePreviewBatches, profilePreviewOrphanSource } from './profile-preview-fixtures';
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
});
