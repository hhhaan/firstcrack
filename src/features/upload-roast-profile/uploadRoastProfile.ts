import { logger } from '@shared/lib/logger';
import { bbpKeyForUser, profileKeyForUser, requestUploadUrl } from '@shared/lib/r2';
import { BaseDirectory, readTextFile } from '@tauri-apps/plugin-fs';

export const uploadRoastProfile = async (sessionId: string, userId: string): Promise<string | null> => {
    let tsvContent: string;
    try {
        tsvContent = await readTextFile(`session_${sessionId}.tsv`, {
            baseDir: BaseDirectory.AppLocalData,
        });
    } catch (err) {
        logger.capture(err, { scope: 'uploadRoastProfile.readTsv' });
        return null;
    }

    const uploadUrl = await requestUploadUrl(sessionId, 'profile', userId);
    const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: tsvContent,
        headers: { 'Content-Type': 'text/tab-separated-values' },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`R2 upload failed (${res.status})${text ? `: ${text}` : ''}`);
    }

    return profileKeyForUser(userId, sessionId);
};

/** BBP 커브 업로드. 로컬 파일 없으면(첫 배치/무료 플랜 등) null. */
export const uploadBbpProfile = async (sessionId: string, userId: string): Promise<string | null> => {
    let tsvContent: string;
    try {
        tsvContent = await readTextFile(`bbp_${sessionId}.tsv`, {
            baseDir: BaseDirectory.AppLocalData,
        });
    } catch (err) {
        logger.capture(err, { scope: 'uploadRoastProfile.readBbpTsv' });
        return null;
    }

    const uploadUrl = await requestUploadUrl(sessionId, 'bbp', userId);
    const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: tsvContent,
        headers: { 'Content-Type': 'text/tab-separated-values' },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`R2 BBP upload failed (${res.status})${text ? `: ${text}` : ''}`);
    }

    return bbpKeyForUser(userId, sessionId);
};
