import { roastSessionApi } from '@entities/roast';
import { roastSessionKeys } from '@entities/roast/queries';
import { deleteSessionTsv, flushTsv } from '@features/active-roast/lib/tsv-writer';
import { dashboardKeys } from '@shared/lib/query-keys';
import { useAuthStore } from '@shared/store/auth';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadRoastProfile } from './uploadRoastProfile';

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
    const user = useAuthStore((s) => s.user);
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ sessionId, roastSessionId }: SyncRoastCurveInput): Promise<string> => {
            if (!user) throw new Error('Not authenticated');
            await flushTsv(sessionId);
            const key = await uploadRoastProfile(sessionId, user.id);
            if (!key) throw new Error('Local TSV missing or empty upload key');
            await roastSessionApi.update({ id: roastSessionId, tsv_path: key });
            await deleteSessionTsv(sessionId);
            return key;
        },
        retry: shouldRetry,
        retryDelay: (attemptIndex) => 1000 * (attemptIndex + 1),
        onSuccess: (_key, { roastSessionId }) => {
            if (!user) return;
            qc.invalidateQueries({ queryKey: roastSessionKeys.all(user.id) });
            qc.invalidateQueries({ queryKey: roastSessionKeys.paginated(user.id) });
            qc.invalidateQueries({ queryKey: dashboardKeys.all(user.id) });
            qc.invalidateQueries({ queryKey: roastSessionKeys.detail(roastSessionId) });
        },
    });
};
