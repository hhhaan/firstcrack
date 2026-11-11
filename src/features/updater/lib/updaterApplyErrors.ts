/**
 * Tauri updater `install()` can return EROFS when the .app lives on a read-only
 * mount (e.g. Downloads / Desktop / mounted DMG). Message shape varies by layer.
 */
export function looksLikeReadOnlyFsError(error: unknown): boolean {
    const text = `${error instanceof Error ? error.message : ''} ${String(error)}`.toLowerCase();
    if (text.includes('read-only file system') || text.includes('readonly file system')) return true;
    if (/\bos error 30\b/.test(text) || /\berror 30\b/.test(text)) return true;
    if (/\bcode:\s*30\b/.test(text)) return true;
    if (text.includes('erofs')) return true;
    return false;
}

export function shouldShowNotInApplicationsHint(params: {
    looksLikeEROFS: boolean;
    inApplications: boolean | null;
}): boolean {
    const { looksLikeEROFS, inApplications } = params;
    return looksLikeEROFS && inApplications !== true;
}
