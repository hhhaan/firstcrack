import type { SaveRoastParams } from './useSaveRoast';

/** Serializable SaveRoastParams — the ref is replaced by its captured value. */
export type PendingRoastParams = Omit<SaveRoastParams, 'roastStartTimeRef'> & { roastStartTime: number };

/**
 * Durable save intent, written to localStorage so a roast survives an auth
 * kick to the login screen, a crash, or a force quit. Recovered on next launch
 * by PendingRoastRecovery.
 */
export type PendingRoastSave = {
    version: 1;
    /** true = Save was clicked (retry silently); false = summary opened but never submitted (ask first). */
    submitted: boolean;
    params: PendingRoastParams;
};

const KEY = 'fc_pending_roast_save';

export const readPendingRoastSave = (): PendingRoastSave | null => {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PendingRoastSave> | null;
        return parsed?.version === 1 && parsed.params != null ? (parsed as PendingRoastSave) : null;
    } catch {
        return null;
    }
};

export const writePendingRoastSave = (pending: PendingRoastSave): void => {
    try {
        localStorage.setItem(KEY, JSON.stringify(pending));
    } catch {
        // Durable backstop only — must never block the save itself.
    }
};

export const clearPendingRoastSave = (): void => {
    try {
        localStorage.removeItem(KEY);
    } catch {
        // noop
    }
};

export const toSaveRoastParams = (params: PendingRoastParams): SaveRoastParams => {
    const { roastStartTime, ...rest } = params;
    return { ...rest, roastStartTimeRef: { current: roastStartTime } };
};
