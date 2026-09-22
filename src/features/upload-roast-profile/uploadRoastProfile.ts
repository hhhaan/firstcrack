import { logger } from '@shared/lib/logger';
import { bbpKeyForUser, profileKeyForUser, requestUploadUrl } from '@shared/lib/r2';
import { BaseDirectory, exists, readTextFile } from '@tauri-apps/plugin-fs';

type CurveKind = 'profile' | 'bbp';

const logCurveStage = (stage: 'curve-presign' | 'curve-put', started: number, kind: CurveKind) => {
    logger.debug('roast-save-stage', {
        stage,
        ms: Date.now() - started,
        parent: 'sync-curve',
        kind,
    });
};

const putCurveTsv = async (sessionId: string, userId: string, kind: CurveKind, tsvContent: string) => {
    const presignStarted = Date.now();
    const uploadUrl = await requestUploadUrl(sessionId, kind, userId).finally(() => {
        logCurveStage('curve-presign', presignStarted, kind);
    });
    const putStarted = Date.now();
    const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: tsvContent,
        headers: { 'Content-Type': 'text/tab-separated-values' },
        signal: AbortSignal.timeout(10_000),
    }).finally(() => {
        logCurveStage('curve-put', putStarted, kind);
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const label = kind === 'bbp' ? 'R2 BBP upload failed' : 'R2 upload failed';
        throw new Error(`${label} (${res.status})${text ? `: ${text}` : ''}`);
    }
    return kind === 'bbp' ? bbpKeyForUser(userId, sessionId) : profileKeyForUser(userId, sessionId);
};

const readCurveTsv = async (path: string, scope: string): Promise<string | null> => {
    try {
        return await readTextFile(path, { baseDir: BaseDirectory.AppLocalData });
    } catch (err) {
        logger.capture(err, { scope });
        return null;
    }
};

export const uploadRoastProfile = async (sessionId: string, userId: string): Promise<string | null> => {
    const tsvContent = await readCurveTsv(`session_${sessionId}.tsv`, 'uploadRoastProfile.readTsv');
    if (tsvContent == null) return null;
    return putCurveTsv(sessionId, userId, 'profile', tsvContent);
};

/** BBP 커브 업로드. 로컬 파일 없으면(첫 배치/무료 플랜 등) null. */
export const uploadBbpProfile = async (sessionId: string, userId: string): Promise<string | null> => {
    const path = `bbp_${sessionId}.tsv`;
    // 파일 부재는 정상 경로(BBP 없는 배치) — 읽기 실패만 Sentry로.
    if (!(await exists(path, { baseDir: BaseDirectory.AppLocalData }))) return null;
    const tsvContent = await readCurveTsv(path, 'uploadRoastProfile.readBbpTsv');
    if (tsvContent == null) return null;
    return putCurveTsv(sessionId, userId, 'bbp', tsvContent);
};
