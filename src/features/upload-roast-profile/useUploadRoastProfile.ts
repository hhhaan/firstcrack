import { useActiveWorkspace } from '@entities/organization';
import { roastSessionApi } from '@entities/roast';
import { roastSessionKeys } from '@entities/roast/queries';
import { logger } from '@shared/lib/logger';
import { dashboardKeys } from '@shared/lib/query-keys';
import { deleteBbpTsv, deleteSessionTsv, flushTsv } from '@shared/lib/tsv-writer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadBbpProfile, uploadRoastProfile } from './uploadRoastProfile';

export type SyncRoastCurveInput = {
    sessionId: string;
    roastSessionId: string;
};

const shouldRetry = (failureCount: number, error: unknown): boolean => {
    if (failureCount >= 3) return false;
    if (!(error instanceof Error)) return true;
    if (error.message.includes('Local TSV missing')) return false;
    if (/R2 upload failed \(4\d\d\)/.test(error.message)) return false;
    return true;
};

/**
 * flush → R2 → tsv_path → delete local (only on full success).
 * Failure leaves local TSV so the curve is not destroyed.
 */
export const useUploadRoastProfile = () => {
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ sessionId, roastSessionId }: SyncRoastCurveInput): Promise<string> => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Not authenticated');
            const ownerId = workspaceOwnerId;
            await flushTsv(sessionId);
            const key = await uploadRoastProfile(sessionId, ownerId);
            if (!key) throw new Error('Local TSV missing or empty upload key');
            await roastSessionApi.update({ id: roastSessionId, tsv_path: key });
            await deleteSessionTsv(sessionId);

            // BBP 커브는 보조 데이터 — 실패해도 메인 동기화는 성공 처리, 로컬 파일 보존
            try {
                const bbpKey = await uploadBbpProfile(sessionId, ownerId);
                if (bbpKey) {
                    await roastSessionApi.update({ id: roastSessionId, bbp_tsv_path: bbpKey });
                    await deleteBbpTsv(sessionId);
                }
            } catch (err) {
                logger.capture(err instanceof Error ? err : new Error(String(err)), {
                    context: 'bbp tsv sync',
                    sessionId,
                });
            }

            return key;
        },
        retry: shouldRetry,
        retryDelay: (attemptIndex) => 1000 * (attemptIndex + 1),
        onSuccess: (_key, { roastSessionId }) => {
            if (!workspaceOwnerId) return;
            void qc.invalidateQueries({ queryKey: roastSessionKeys.all(workspaceOwnerId) });
            void qc.invalidateQueries({ queryKey: roastSessionKeys.paginated(workspaceOwnerId) });
            void qc.invalidateQueries({ queryKey: dashboardKeys.all(workspaceOwnerId) });
            void qc.invalidateQueries({ queryKey: roastSessionKeys.detail(roastSessionId) });
        },
    });
};
