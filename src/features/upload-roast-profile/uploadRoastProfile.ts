import { logger } from '@shared/lib/logger';
import { bbpKeyForUser, profileKeyForUser, requestUploadUrl } from '@shared/lib/r2';
import { BaseDirectory, exists, readTextFile } from '@tauri-apps/plugin-fs';

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

    const presignStarted = Date.now();
    const uploadUrl = await requestUploadUrl(sessionId, 'profile', userId).finally(() => {
        logger.debug('roast-save-stage', {
            stage: 'curve-presign',
            ms: Date.now() - presignStarted,
            parent: 'sync-curve',
            kind: 'profile',
        });
    });
    const putStarted = Date.now();
    const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: tsvContent,
        headers: { 'Content-Type': 'text/tab-separated-values' },
        signal: AbortSignal.timeout(10_000),
    }).finally(() => {
        logger.debug('roast-save-stage', {
            stage: 'curve-put',
            ms: Date.now() - putStarted,
            parent: 'sync-curve',
            kind: 'profile',
        });
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`R2 upload failed (${res.status})${text ? `: ${text}` : ''}`);
    }

    return profileKeyForUser(userId, sessionId);
};

/** BBP 커브 업로드. 로컬 파일 없으면(첫 배치/무료 플랜 등) null. */
export const uploadBbpProfile = async (sessionId: string, userId: string): Promise<string | null> => {
    const path = `bbp_${sessionId}.tsv`;
    // 파일 부재는 정상 경로(BBP 없는 배치) — 읽기 실패만 Sentry로.
    if (!(await exists(path, { baseDir: BaseDirectory.AppLocalData }))) return null;
    let tsvContent: string;
    try {
        tsvContent = await readTextFile(path, { baseDir: BaseDirectory.AppLocalData });
    } catch (err) {
        logger.capture(err, { scope: 'uploadRoastProfile.readBbpTsv' });
        return null;
    }

    const presignStarted = Date.now();
    const uploadUrl = await requestUploadUrl(sessionId, 'bbp', userId).finally(() => {
        logger.debug('roast-save-stage', {
            stage: 'curve-presign',
            ms: Date.now() - presignStarted,
            parent: 'sync-curve',
            kind: 'bbp',
        });
    });
    const putStarted = Date.now();
    const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: tsvContent,
        headers: { 'Content-Type': 'text/tab-separated-values' },
        signal: AbortSignal.timeout(10_000),
    }).finally(() => {
        logger.debug('roast-save-stage', {
            stage: 'curve-put',
            ms: Date.now() - putStarted,
            parent: 'sync-curve',
            kind: 'bbp',
        });
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`R2 BBP upload failed (${res.status})${text ? `: ${text}` : ''}`);
    }

    return bbpKeyForUser(userId, sessionId);
};
