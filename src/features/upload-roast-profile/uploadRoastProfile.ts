import { profileKeyForUser, requestUploadUrl } from '@shared/lib/r2';
import { BaseDirectory, readTextFile, remove } from '@tauri-apps/plugin-fs';

export const uploadRoastProfile = async (sessionId: string, userId: string): Promise<string | null> => {
    if (!('__TAURI_INTERNALS__' in window)) return null;

    let tsvContent: string;
    try {
        tsvContent = await readTextFile(`session_${sessionId}.tsv`, {
            baseDir: BaseDirectory.AppLocalData,
        });
    } catch {
        return null;
    }

    const uploadUrl = await requestUploadUrl(sessionId);
    const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: tsvContent,
        headers: { 'Content-Type': 'text/tab-separated-values' },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`R2 upload failed (${res.status})${text ? `: ${text}` : ''}`);
    }

    const r2Key = profileKeyForUser(userId, sessionId);
    remove(`session_${sessionId}.tsv`, { baseDir: BaseDirectory.AppLocalData }).catch(() => {});
    return r2Key;
};
