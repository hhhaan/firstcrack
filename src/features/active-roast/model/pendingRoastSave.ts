import { logger } from '@shared/lib/logger';
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
    /** 22P02 / unresolvable plan id — keep the snapshot; do not auto-clear. */
    needsAttention?: boolean;
    params: PendingRoastParams;
};

const KEY = 'fc_pending_roast_save';

export const readPendingRoastSave = (): PendingRoastSave | null => {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PendingRoastSave> | null;
        return parsed?.version === 1 && parsed.params != null ? (parsed as PendingRoastSave) : null;
    } catch (err) {
        logger.capture(err, { scope: 'pendingRoastSave.read' });
        return null;
    }
};

export const writePendingRoastSave = (pending: PendingRoastSave): void => {
    try {
        localStorage.setItem(KEY, JSON.stringify(pending));
    } catch (err) {
        // Durable backstop only — must never block the save itself.
        logger.capture(err, { scope: 'pendingRoastSave.write' });
    }
};

export const clearPendingRoastSave = (): void => {
    try {
        localStorage.removeItem(KEY);
    } catch (err) {
        logger.capture(err, { scope: 'pendingRoastSave.clear' });
        // noop
    }
};

export const toSaveRoastParams = (params: PendingRoastParams): SaveRoastParams => {
    const { roastStartTime, ...rest } = params;
    return { ...rest, roastStartTimeRef: { current: roastStartTime } };
};
