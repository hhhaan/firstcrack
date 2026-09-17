import { patchRoastSessionTsvPaths, roastSessionApi } from '@entities/roast';
import { deleteBbpTsv, deleteSessionTsv, flushTsv } from '@shared/lib/tsv-writer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadBbpProfile, uploadRoastProfile } from './uploadRoastProfile';

export type SyncRoastCurveInput = {
    sessionId: string;
    roastSessionId: string;
    ownerId: string;
    profileRequired: boolean;
    bbpRequired: boolean;
};

type UploadResult = { key: string | null; bbpKey: string | null };

const shouldRetry = (failureCount: number, error: unknown): boolean => {
    if (failureCount >= 3) return false;
    if (!(error instanceof Error)) return true;
    if (/Local .*TSV missing|session mismatch/.test(error.message)) return false;
    if (/R2 (?:BBP )?upload failed \(4\d\d\)/.test(error.message)) return false;
    return true;
};

/** Resume only missing artifacts; DB-confirmed paths authorize local cleanup. */
export const syncRoastProfile = async ({
    sessionId,
    roastSessionId,
    ownerId,
    profileRequired,
    bbpRequired,
}: SyncRoastCurveInput): Promise<UploadResult> => {
    if (!sessionId || sessionId !== roastSessionId || !ownerId) throw new Error('Upload session mismatch');
    let row = await roastSessionApi.find(roastSessionId);
    const assertSession = (session: typeof row) => {
        if (!session || session.id !== sessionId || session.user_id !== ownerId || session.status !== 'completed') {
            throw new Error('Upload session mismatch');
        }
        return session;
    };
    row = assertSession(row);
    if (profileRequired && !row.tsv_path) {
        await flushTsv(sessionId);
        const key = await uploadRoastProfile(sessionId, ownerId);
        if (!key) throw new Error('Local TSV missing or empty upload key');
        row = assertSession(await roastSessionApi.update({ id: roastSessionId, tsv_path: key }));
        if (row.tsv_path !== key) throw new Error('Profile path was not confirmed');
        await deleteSessionTsv(sessionId);
    }
    if (bbpRequired && !row.bbp_tsv_path) {
        const bbpKey = await uploadBbpProfile(sessionId, ownerId);
        if (!bbpKey) throw new Error('Local BBP TSV missing or empty upload key');
        row = assertSession(await roastSessionApi.update({ id: roastSessionId, bbp_tsv_path: bbpKey }));
        if (row.bbp_tsv_path !== bbpKey) throw new Error('BBP path was not confirmed');
        await deleteBbpTsv(sessionId);
    }
    return { key: row.tsv_path, bbpKey: row.bbp_tsv_path };
};

export const useUploadRoastProfile = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: syncRoastProfile,
        retry: shouldRetry,
        retryDelay: (attemptIndex) => 1000 * (attemptIndex + 1),
        onSuccess: ({ key, bbpKey }, { roastSessionId, ownerId }) => {
            patchRoastSessionTsvPaths(qc, ownerId, roastSessionId, key, bbpKey);
        },
    });
};
