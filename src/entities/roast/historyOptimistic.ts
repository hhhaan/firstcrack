import type { RoastSessionWithRelations } from '@shared/types/database.types';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

export type RoastSessionPatch = (row: RoastSessionWithRelations) => RoastSessionWithRelations;
type CachePatch = (value: unknown, key: QueryKey) => unknown;
type Snapshot = Map<string, [QueryKey, unknown]>;

export type OptimisticRoastSessionEdit = { readonly id: symbol; readonly userId: string };

type Operation = OptimisticRoastSessionEdit & { patch: CachePatch; pending: boolean };
type Group = {
    baseline: Snapshot;
    operations: Operation[];
    replaying: boolean;
    reconciledKeys: Set<string>;
    reconciliations: Array<() => Promise<void>>;
    unsubscribe: () => void;
    reconciliation?: Promise<void>;
};

const groups = new WeakMap<QueryClient, Map<string, Group>>();
const root = (userId: string) => ['roast_sessions', userId] as const;

const isRow = (value: unknown): value is RoastSessionWithRelations =>
    !!value && typeof value === 'object' && 'id' in value && 'status' in value;

const mapRows = (rows: RoastSessionWithRelations[], patch: RoastSessionPatch) => {
    let changed = false;
    const next = rows.map((row) => {
        const patched = patch(row);
        changed ||= patched !== row;
        return patched;
    });
    return changed ? next : rows;
};

const patchRowsInCache = (value: unknown, patch: RoastSessionPatch): unknown => {
    if (Array.isArray(value)) return value.length === 0 || isRow(value[0]) ? mapRows(value, patch) : value;
    if (!value || typeof value !== 'object') return value;
    if ('pages' in value && Array.isArray(value.pages)) {
        return {
            ...value,
            pages: value.pages.map((page) =>
                page && typeof page === 'object' && 'data' in page && Array.isArray(page.data)
                    ? { ...page, data: mapRows(page.data, patch) }
                    : page,
            ),
        };
    }
    if ('data' in value && Array.isArray(value.data)) return { ...value, data: mapRows(value.data, patch) };
    return isRow(value) ? patch(value) : value;
};

const replay = (qc: QueryClient, group: Group, entries: Iterable<[QueryKey, unknown]> = group.baseline.values()) => {
    group.replaying = true;
    try {
        for (const [key, value] of entries) {
            qc.setQueryData(
                key,
                group.operations.reduce((current, operation) => operation.patch(current, key), value),
            );
        }
    } finally {
        group.replaying = false;
    }
};

const mapFor = (qc: QueryClient) => {
    let map = groups.get(qc);
    if (!map) {
        map = new Map();
        groups.set(qc, map);
    }
    return map;
};

const beginOptimisticRoastSessionCacheEdit = async (
    qc: QueryClient,
    userId: string,
    patch: CachePatch,
): Promise<OptimisticRoastSessionEdit> => {
    const map = mapFor(qc);
    for (;;) {
        const existing = map.get(userId);
        if (existing?.reconciliation) {
            await existing.reconciliation.catch(() => undefined);
            continue;
        }
        await qc.cancelQueries({ queryKey: root(userId) });
        const current = map.get(userId);
        if (!current?.reconciliation) break;
        await current.reconciliation.catch(() => undefined);
    }

    let group = map.get(userId);
    if (!group) {
        group = {
            baseline: new Map(
                qc
                    .getQueryCache()
                    .findAll({ queryKey: root(userId) })
                    .map((query) => [query.queryHash, [query.queryKey, query.state.data]]),
            ),
            operations: [],
            replaying: false,
            reconciledKeys: new Set(),
            reconciliations: [],
            unsubscribe: () => undefined,
        };
        const current = group;
        group.unsubscribe = qc.getQueryCache().subscribe((event) => {
            if (current.replaying) return;
            const key = event.query.queryKey;
            if (key[0] !== 'roast_sessions' || key[1] !== userId) return;
            const hash = event.query.queryHash;
            if (event.type === 'removed') {
                current.baseline.delete(hash);
                current.reconciledKeys.delete(hash);
                return;
            }
            if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
            current.baseline.set(hash, [key, event.query.state.data]);
            if (current.reconciliation) current.reconciledKeys.add(hash);
            replay(qc, current, [[key, event.query.state.data]]);
        });
        map.set(userId, group);
    }

    const context = { id: Symbol('roast-session-edit'), userId };
    group.operations.push({ ...context, patch, pending: true });
    replay(qc, group);
    return context;
};

export const revertOptimisticRoastSessionEdit = (
    qc: QueryClient,
    userId: string,
    context: OptimisticRoastSessionEdit | undefined,
) => {
    if (!context) return;
    const group = groups.get(qc)?.get(userId);
    if (!group) return;
    group.operations = group.operations.filter((operation) => operation.id !== context.id);
    replay(qc, group);
};

export const finishOptimisticRoastSessionEdit = async (
    qc: QueryClient,
    userId: string,
    context: OptimisticRoastSessionEdit | undefined,
    reconcile: () => Promise<void>,
) => {
    if (!context) return;
    const map = groups.get(qc);
    const group = map?.get(userId);
    if (!group) return;
    const operation = group.operations.find((candidate) => candidate.id === context.id);
    if (operation) operation.pending = false;
    group.reconciliations.push(reconcile);
    if (group.operations.some((candidate) => candidate.pending) || group.reconciliation) return;

    group.reconciliation = Promise.resolve().then(() =>
        Promise.all(group.reconciliations.map((run) => run())).then(() => undefined),
    );
    try {
        await group.reconciliation;
    } finally {
        group.replaying = true;
        for (const hash of group.reconciledKeys) {
            const entry = group.baseline.get(hash);
            if (entry && qc.getQueryCache().get(hash)) qc.setQueryData(entry[0], entry[1]);
        }
        group.unsubscribe();
        map?.delete(userId);
    }
};

export const beginOptimisticSessionBeanOrigin = (
    qc: QueryClient,
    userId: string,
    beanId: string,
    origin: string | null,
) =>
    beginOptimisticRoastSessionCacheEdit(qc, userId, (value) =>
        patchRowsInCache(value, (row) =>
            row.bean_id === beanId && row.beans ? { ...row, beans: { ...row.beans, origin } } : row,
        ),
    );

export const beginOptimisticRoastSessionEdit = (qc: QueryClient, userId: string, patch: RoastSessionPatch) =>
    beginOptimisticRoastSessionCacheEdit(qc, userId, (value) => patchRowsInCache(value, patch));

export const patchOptimisticRoastSessionBaseline = (qc: QueryClient, userId: string, patch: RoastSessionPatch) => {
    const group = groups.get(qc)?.get(userId);
    if (!group) {
        qc.setQueriesData({ queryKey: root(userId) }, (value) => patchRowsInCache(value, patch));
        return;
    }
    for (const [hash, [key, value]] of group.baseline) {
        group.baseline.set(hash, [key, patchRowsInCache(value, patch)]);
    }
    replay(qc, group);
};

export const beginOptimisticRoastSessionDelete = (qc: QueryClient, userId: string, id: string) =>
    beginOptimisticRoastSessionCacheEdit(qc, userId, (value, key) => {
        if (key[2] === 'detail') return value;
        if (Array.isArray(value))
            return value.length === 0 || isRow(value[0]) ? value.filter((row) => row.id !== id) : value;
        if (!value || typeof value !== 'object') return value;
        if ('pages' in value && Array.isArray(value.pages)) {
            const hit = value.pages.some(
                (page) =>
                    page &&
                    typeof page === 'object' &&
                    'data' in page &&
                    Array.isArray(page.data) &&
                    page.data.some((row: unknown) => isRow(row) && row.id === id),
            );
            return {
                ...value,
                pages: value.pages.map((page) =>
                    page && typeof page === 'object' && 'data' in page && Array.isArray(page.data)
                        ? {
                              ...page,
                              data: page.data.filter((row: unknown) => !isRow(row) || row.id !== id),
                              ...('total' in page && typeof page.total === 'number' && hit
                                  ? { total: Math.max(0, page.total - 1) }
                                  : {}),
                          }
                        : page,
                ),
            };
        }
        if ('data' in value && Array.isArray(value.data)) {
            const hit = value.data.some((row) => isRow(row) && row.id === id);
            return {
                ...value,
                data: value.data.filter((row) => !isRow(row) || row.id !== id),
                ...('total' in value && typeof value.total === 'number' && hit
                    ? { total: Math.max(0, value.total - 1) }
                    : {}),
            };
        }
        return value;
    });
