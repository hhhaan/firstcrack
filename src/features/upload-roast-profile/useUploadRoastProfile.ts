import { useActiveWorkspace } from '@entities/organization';
import { roastSessionApi } from '@entities/roast';
import { roastSessionKeys } from '@entities/roast/queries';
import { logger } from '@shared/lib/logger';
import { deleteBbpTsv, deleteSessionTsv, flushTsv } from '@shared/lib/tsv-writer';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadBbpProfile, uploadRoastProfile } from './uploadRoastProfile';

export type SyncRoastCurveInput = {
    sessionId: string;
    roastSessionId: string;
};

type UploadResult = { key: string; bbpKey: string | null };

const shouldRetry = (failureCount: number, error: unknown): boolean => {
    if (failureCount >= 3) return false;
    if (!(error instanceof Error)) return true;
    if (error.message.includes('Local TSV missing')) return false;
    if (/R2 upload failed \(4\d\d\)/.test(error.message)) return false;
    return true;
};

type PaginatedCache = { data: RoastSessionWithRelations[]; total: number };

const isPaginatedCache = (old: unknown): old is PaginatedCache =>
    !!old && typeof old === 'object' && 'data' in old && Array.isArray((old as PaginatedCache).data);

/**
 * flush → R2 (main + optional BBP) → single DB update → delete local (only on full success).
 * Failure leaves local TSV so the curve is not destroyed.
 * BBP upload failure is non-fatal (main still succeeds; BBP local preserved).
 */
export const useUploadRoastProfile = () => {
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ sessionId, roastSessionId }: SyncRoastCurveInput): Promise<UploadResult> => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Not authenticated');
            const ownerId = workspaceOwnerId;
            await flushTsv(sessionId);
            const key = await uploadRoastProfile(sessionId, ownerId);
            if (!key) throw new Error('Local TSV missing or empty upload key');

            // BBP is auxiliary — failure must not fail the main sync; keep local BBP file.
            let bbpKey: string | null = null;
            try {
                bbpKey = (await uploadBbpProfile(sessionId, ownerId)) ?? null;
            } catch (err) {
                logger.capture(err instanceof Error ? err : new Error(String(err)), {
                    context: 'bbp tsv sync',
                    sessionId,
                });
            }

            await roastSessionApi.update({
                id: roastSessionId,
                tsv_path: key,
                ...(bbpKey ? { bbp_tsv_path: bbpKey } : {}),
            });
            await deleteSessionTsv(sessionId);
            if (bbpKey) await deleteBbpTsv(sessionId);

            return { key, bbpKey };
        },
        retry: shouldRetry,
        retryDelay: (attemptIndex) => 1000 * (attemptIndex + 1),
        onSuccess: ({ key, bbpKey }, { roastSessionId }) => {
            // Patch path fields into list caches (network 0) — do not invalidate unbounded lists.
            // Shape-guard: filterMeta and other non-list shapes under prefix must pass through.
            const patch = (row: RoastSessionWithRelations) =>
                row.id === roastSessionId ? { ...row, tsv_path: key, bbp_tsv_path: bbpKey ?? row.bbp_tsv_path } : row;

            qc.setQueriesData({ queryKey: ['roast_sessions'] }, (old: unknown) => {
                if (Array.isArray(old)) return (old as RoastSessionWithRelations[]).map(patch);
                if (isPaginatedCache(old)) return { ...old, data: old.data.map(patch) };
                return old;
            });
            void qc.invalidateQueries({ queryKey: roastSessionKeys.detail(roastSessionId) });
        },
    });
};
