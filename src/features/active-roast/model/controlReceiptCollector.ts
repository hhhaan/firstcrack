import { roastSessionApi } from '@entities/roast';
import { sidecar } from '@shared/lib/sidecar';
import type { LogEntry } from '@shared/types/roast';
import type { Charge } from '@shared/types/sidecar';
import { z } from 'zod';
import { create } from 'zustand';
import {
    controlReceiptMetadataSchema,
    mergeReceiptLogs,
    parseControlReceipt,
    receiptLogEntry,
    unresolvedReceiptAttempts,
} from '../lib/control-receipts';
import { serializeRoastEvents } from '../lib/serialize-roast-events';
import {
    readPendingControlReceipts,
    readPendingRoastSave,
    writePendingControlReceipts,
    writePendingRoastSave,
} from './pendingRoastSave';
import { useRoastingStore } from './status';

type Collection = {
    charge: Pick<Charge, 'session_id' | 'charge_id'> & { sensor_clock: string | null; connection_epoch: number | null };
    ownerId: string;
    after: number;
    entries: LogEntry[];
    unavailable: boolean;
    saved: boolean;
    syncedCount: number;
};
export const useControlReceiptStore = create<{ collections: Record<string, Collection> }>(() => ({ collections: {} }));
const inFlight = new Map<string, Promise<void>>();
const pendingCollectionSchema = z.object({
    charge: z.object({
        session_id: z.string(),
        charge_id: z.string(),
        sensor_clock: z.string().nullable(),
        connection_epoch: z.number().nullable(),
    }),
    ownerId: z.string(),
    after: z.number().int().nonnegative(),
    entries: z.array(
        z.object({
            id: z.string(),
            event: z.literal('Control'),
            time: z.string(),
            timeSec: z.number(),
            temp: z.string(),
            tempC: z.number().nullable(),
            note: z.string(),
            controlReceipt: controlReceiptMetadataSchema,
            appliedControl: z.object({ heater: z.number().optional() }).optional(),
        }),
    ),
    saved: z.literal(true),
    syncedCount: z.number().int().nonnegative(),
    unavailable: z.boolean(),
});

export const restoreReceiptCollections = () => {
    const restored = z.array(pendingCollectionSchema).parse(readPendingControlReceipts());
    const collections = { ...useControlReceiptStore.getState().collections };
    for (const collection of restored) collections[collection.charge.session_id] ??= collection;
    useControlReceiptStore.setState({ collections });
};
const checkpointReceipts = () => {
    const pending = Object.values(useControlReceiptStore.getState().collections).filter(
        (collection) =>
            collection.saved &&
            (collection.syncedCount < collection.entries.length || unresolvedReceiptAttempts(collection.entries) > 0),
    );
    writePendingControlReceipts(pending);
};

export const registerReceiptCollection = (charge: Charge, ownerId: string) => {
    const collections = useControlReceiptStore.getState().collections;
    if (collections[charge.session_id]) return;
    useControlReceiptStore.setState({
        collections: {
            ...collections,
            [charge.session_id]: {
                charge,
                ownerId,
                after: 0,
                entries: [],
                unavailable: false,
                saved: false,
                syncedCount: 0,
            },
        },
    });
};
/** Recover evidence from an interrupted save without reconstructing machine control authority. */
export const recoverPendingReceiptCollection = (sessionId: string, ownerId: string, entries: LogEntry[]) => {
    const evidence = entries.flatMap((entry) => {
        if (!entry.controlReceipt) return [];
        const metadata = controlReceiptMetadataSchema.parse(entry.controlReceipt);
        const identity = metadata.kind === 'receipt' ? metadata.receipt : metadata;
        if (identity.session_id !== sessionId) throw new Error('Pending receipt session mismatch');
        return [receiptLogEntry(metadata)];
    });
    if (!evidence.length) return;
    const metadata = evidence[0].controlReceipt;
    if (!metadata) return;
    const chargeId = metadata.kind === 'receipt' ? metadata.receipt.charge_id : metadata.charge_id;
    const known = evidence.flatMap((entry) =>
        entry.controlReceipt?.kind === 'receipt' ? [entry.controlReceipt.receipt] : [],
    );
    if (
        evidence.some((entry) => {
            const item = entry.controlReceipt;
            return item && (item.kind === 'receipt' ? item.receipt.charge_id : item.charge_id) !== chargeId;
        })
    )
        throw new Error('Pending receipt Charge mismatch');
    const previous = useControlReceiptStore.getState().collections[sessionId];
    if (previous && (previous.ownerId !== ownerId || previous.charge.charge_id !== chargeId))
        throw new Error('Pending receipt owner mismatch');
    const collection: Collection = previous ?? {
        charge: {
            session_id: sessionId,
            charge_id: chargeId,
            sensor_clock: known[0]?.sensor_clock ?? null,
            connection_epoch: known[0]?.connection_epoch ?? null,
        },
        ownerId,
        after: Math.max(0, ...known.map((receipt) => receipt.sequence)),
        entries: [],
        unavailable: !known.length,
        saved: false,
        syncedCount: 0,
    };
    replaceCollection({ ...collection, entries: mergeReceiptLogs(collection.entries, evidence) });
};

const replaceCollection = (collection: Collection) => {
    const previous = useControlReceiptStore.getState().collections[collection.charge.session_id];
    if (
        previous &&
        previous.entries === collection.entries &&
        previous.after === collection.after &&
        previous.saved === collection.saved &&
        previous.syncedCount === collection.syncedCount &&
        previous.unavailable === collection.unavailable
    )
        return;
    useControlReceiptStore.setState((state) => ({
        collections: {
            ...state.collections,
            [collection.charge.session_id]: collection,
        },
    }));
    if (collection.saved) checkpointReceipts();
};

const retainLogs = (collection: Collection) => {
    const sessionId = collection.charge.session_id;
    useRoastingStore.setState((state) => {
        if (state.sessionId === sessionId)
            return {
                logState: {
                    ...state.logState,
                    entries: mergeReceiptLogs(state.logState.entries, collection.entries),
                },
            };
        const completed = state.completed;
        if (completed?.snapshot.sessionId !== sessionId) return state;
        return {
            completed: {
                ...completed,
                snapshot: {
                    ...completed.snapshot,
                    logEntries: mergeReceiptLogs(completed.snapshot.logEntries, collection.entries),
                },
                summary: completed.summary
                    ? {
                          ...completed.summary,
                          logEntries: mergeReceiptLogs(completed.summary.logEntries, collection.entries),
                      }
                    : null,
                restore: completed.restore
                    ? {
                          ...completed.restore,
                          logEntries: mergeReceiptLogs(completed.restore.logEntries, collection.entries),
                      }
                    : null,
            },
        };
    });
    const pending = readPendingRoastSave(collection.ownerId, sessionId);
    const pendingIds = new Set(pending?.params.logEntries.map((entry) => entry.id));
    if (pending && collection.entries.some((entry) => !pendingIds.has(entry.id)))
        writePendingRoastSave({
            ...pending,
            params: { ...pending.params, logEntries: mergeReceiptLogs(pending.params.logEntries, collection.entries) },
        });
};

/** Read evidence only. Captured Charge identity fences late replies from subsequent batches. */
export const drainControlReceipts = (sessionId: string): Promise<void> => {
    const pending = inFlight.get(sessionId);
    if (pending !== undefined) return pending;
    const job = (async () => {
        let collection = useControlReceiptStore.getState().collections[sessionId];
        if (!collection || collection.charge.sensor_clock === null) return;
        try {
            let target: number | undefined;
            for (let pages = 0; pages < 64; pages += 1) {
                const page = await sidecar.getPidReceipts(collection.charge.charge_id, collection.after);
                if (
                    page.session_id !== sessionId ||
                    page.charge_id !== collection.charge.charge_id ||
                    page.receipts.some(
                        (receipt) =>
                            receipt.session_id !== sessionId ||
                            receipt.charge_id !== collection.charge.charge_id ||
                            receipt.sensor_clock !== collection.charge.sensor_clock,
                    )
                )
                    throw new Error('Receipt identity changed');
                if (
                    !Number.isInteger(page.next_after) ||
                    page.next_after < collection.after ||
                    !Number.isInteger(page.next_sequence) ||
                    page.next_sequence <= page.next_after
                )
                    throw new Error('Invalid receipt cursor');
                const lastReceipt = page.receipts[page.receipts.length - 1];
                if (
                    page.next_after !== (lastReceipt?.sequence ?? collection.after) ||
                    page.has_more !== page.next_after < page.next_sequence - 1
                )
                    throw new Error('Receipt cursor advanced without evidence');
                let expected = page.gap ? page.gap.through + 1 : collection.after + 1;
                for (const receipt of page.receipts.filter((entry) => entry.sequence > collection.after)) {
                    if (!parseControlReceipt({ kind: 'receipt', receipt }) || receipt.sequence !== expected++)
                        throw new Error('Incomplete receipt page');
                }
                target ??= page.next_sequence - 1;
                const incoming = page.receipts
                    .filter((receipt) => receipt.sequence > collection.after)
                    .map((receipt) => receiptLogEntry({ kind: 'receipt', receipt }));
                if (page.gap)
                    incoming.unshift(
                        receiptLogEntry({
                            kind: 'gap',
                            session_id: sessionId,
                            charge_id: collection.charge.charge_id,
                            ...page.gap,
                        }),
                    );
                collection = {
                    ...collection,
                    ...useControlReceiptStore.getState().collections[sessionId],
                    after: page.next_after,
                    unavailable: false,
                    entries: mergeReceiptLogs(collection.entries, incoming),
                };
                replaceCollection(collection);
                if (incoming.length) retainLogs(collection);
                if (!page.has_more || collection.after >= target) break;
                if (pages === 63) throw new Error('Receipt drain remains incomplete');
            }
        } catch {
            const previousEntries = collection.entries;
            collection = {
                ...collection,
                ...useControlReceiptStore.getState().collections[sessionId],
                unavailable: true,
                entries: mergeReceiptLogs(collection.entries, [
                    receiptLogEntry({
                        kind: 'unavailable',
                        session_id: sessionId,
                        charge_id: collection.charge.charge_id,
                        after: collection.after,
                    }),
                ]),
            };
            replaceCollection(collection);
            if (collection.entries !== previousEntries) retainLogs(collection);
        }
    })().finally(() => inFlight.delete(sessionId));
    inFlight.set(sessionId, job);
    return job;
};

export const receiptLogsForSave = (sessionId: string, entries: LogEntry[]) =>
    mergeReceiptLogs(entries, useControlReceiptStore.getState().collections[sessionId]?.entries ?? []);

export const markReceiptSessionSaved = (sessionId: string) => {
    const collection = useControlReceiptStore.getState().collections[sessionId];
    if (collection) replaceCollection({ ...collection, saved: true });
};

export const syncSavedControlReceipts = async (sessionId: string): Promise<boolean> => {
    const collection = useControlReceiptStore.getState().collections[sessionId];
    if (!collection?.saved || collection.syncedCount === collection.entries.length) return false;
    let changed: boolean;
    try {
        changed = await roastSessionApi.appendControlReceipts(
            collection.ownerId,
            sessionId,
            serializeRoastEvents(collection.entries),
        );
    } catch (error) {
        const current = useControlReceiptStore.getState().collections[sessionId];
        if (current) replaceCollection({ ...current, unavailable: true });
        throw error;
    }
    const current = useControlReceiptStore.getState().collections[sessionId];
    if (current) replaceCollection({ ...current, syncedCount: collection.entries.length });
    return changed;
};
