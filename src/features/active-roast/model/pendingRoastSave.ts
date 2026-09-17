import type { SaveRoastParams } from './useSaveRoast';

export type PendingRoastParams = Omit<SaveRoastParams, 'roastStartTimeRef'> & { roastStartTime: number };
export type SyncState = 'pending' | 'synced' | 'not_required';
export type PendingRoastSave = {
    version: 2;
    submitted: boolean;
    needsAttention: boolean;
    error?: string;
    legacyBbpUnknown?: boolean;
    db: 'pending' | 'saved';
    batch: SyncState;
    profile: SyncState;
    bbp: SyncState;
    params: PendingRoastParams;
};
const LEGACY_KEY = 'fc_pending_roast_save';
const KEY = 'fc_pending_roast_saves_v2';
const entryKey = (ownerId: string, sessionId: string | null) => `${ownerId}:${sessionId ?? 'legacy-null'}`;
const persist = (entries: Record<string, PendingRoastSave>) => {
    const raw = JSON.stringify(entries);
    localStorage.setItem(KEY, raw);
    if (localStorage.getItem(KEY) !== raw) throw new Error('Pending roast could not be persisted');
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('fc-pending-roast-save'));
};

export const createPendingRoastSave = (params: PendingRoastParams, submitted: boolean): PendingRoastSave => ({
    version: 2,
    submitted,
    needsAttention: false,
    db: 'pending',
    batch:
        params.planBatchHandoff || params.formData.linkedBatch || params.formData.linkedBatchId
            ? 'pending'
            : 'not_required',
    profile: params.sessionId ? 'pending' : 'not_required',
    bbp: params.bbpSummary ? 'pending' : 'not_required',
    params: { ...params, sessionId: params.sessionId ?? crypto.randomUUID() },
});

const entries = (): Record<string, PendingRoastSave> => {
    const raw = localStorage.getItem(KEY);
    const all = raw ? JSON.parse(raw) : {};
    if (
        !all ||
        typeof all !== 'object' ||
        Array.isArray(all) ||
        Object.values(all).some(
            (p) => !p || typeof p !== 'object' || !('version' in p) || p.version !== 2 || !('params' in p),
        )
    ) {
        throw new Error('Invalid pending roast storage; original data preserved');
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
        const p = JSON.parse(legacy);
        if (p?.version !== 1 || !p.params?.userId || !p.params.formData) {
            throw new Error('Invalid legacy pending roast; original data preserved');
        }
        const key = entryKey(p.params.userId, p.params.sessionId);
        if (!all[key]) {
            all[key] = {
                ...createPendingRoastSave(p.params, p.submitted),
                // A legacy null ID may already have committed under an unknown server ID.
                params: p.params,
                needsAttention: Boolean(p.needsAttention || !p.params.sessionId),
                ...(p.params.sessionId
                    ? {}
                    : { error: 'Legacy save has no session ID; check history before discarding.' }),
                // Legacy BBP intent was not captured. Preserve uncertainty for explicit confirmation.
                bbp: p.params.bbpSummary ? 'pending' : 'not_required',
                legacyBbpUnknown: !('bbpSummary' in p.params),
            };
            persist(all);
        }
        localStorage.removeItem(LEGACY_KEY);
    }
    return all;
};
export const listPendingRoastSaves = (): PendingRoastSave[] => Object.values(entries());
export const readPendingRoastSave = (ownerId: string, sessionId: string | null): PendingRoastSave | null =>
    entries()[entryKey(ownerId, sessionId)] ?? null;
export const writePendingRoastSave = (pending: PendingRoastSave): void => {
    const all = entries();
    all[entryKey(pending.params.userId, pending.params.sessionId)] = pending;
    persist(all);
};
export const clearPendingRoastSave = (ownerId: string, sessionId: string | null): void => {
    const all = entries();
    delete all[entryKey(ownerId, sessionId)];
    persist(all);
};
export const toSaveRoastParams = (params: PendingRoastParams): SaveRoastParams => {
    const { roastStartTime, ...rest } = params;
    return { ...rest, roastStartTimeRef: { current: roastStartTime } };
};
