import { useActiveWorkspace } from '@entities/organization';
import { patchRoastSessionTsvPaths, roastSessionApi } from '@entities/roast';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { deleteBbpTsv, deleteSessionTsv, flushTsv } from '@shared/lib/tsv-writer';
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
            await sidecar.stopSession().catch(() => {});
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
            if (!workspaceOwnerId) return;
            // Patch path fields into list caches (network 0) — do not invalidate unbounded lists.
            patchRoastSessionTsvPaths(qc, workspaceOwnerId, roastSessionId, key, bbpKey);
        },
    });
};
