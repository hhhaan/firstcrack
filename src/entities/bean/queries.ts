import { isOptimisticId } from '@shared/lib/optimistic-id';
import { inventoryQueryRoots } from '@shared/lib/query-keys';
import type { Bean } from '@shared/types/database.types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { beanApi } from './api';

/** Swap the optimistic row for the server row, keeping its place in the list. */
export const replaceOptimisticBean = (list: Bean[], real: Bean, tempId?: string): Bean[] => {
    const drop = (bean: Bean) => bean.id === tempId;
    const out: Bean[] = [];
    let placed = false;
    for (const bean of list) {
        if (bean.id === real.id) continue;
        if (drop(bean)) {
            if (!placed) {
                out.push(real);
                placed = true;
            }
            continue;
        }
        out.push(bean);
    }
    return placed ? out : [real, ...out];
};

export const beanKeys = {
    all: (userId: string) => ['beans', userId] as const,
    detail: (id: string) => ['beans', 'detail', id] as const,
};

export const useBeans = (userId: string, options?: { enabled?: boolean }) =>
    useQuery({
        queryKey: beanKeys.all(userId),
        queryFn: () => beanApi.list(userId),
        enabled: !!userId && (options?.enabled ?? true),
    });

export const useBean = (id: string) =>
    useQuery({
        queryKey: beanKeys.detail(id),
        queryFn: () => beanApi.get(id),
        enabled: !!id && !isOptimisticId(id),
    });

export const useCreateBean = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: beanApi.create,
        onMutate: async (newBean) => {
            await qc.cancelQueries({ queryKey: beanKeys.all(userId) });
            const prev = qc.getQueryData<Bean[]>(beanKeys.all(userId));
            const tempId = `opt_${crypto.randomUUID()}`;
            const optimistic = {
                id: tempId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...newBean,
            } as Bean;
            qc.setQueryData<Bean[]>(beanKeys.all(userId), (old = []) => [optimistic, ...old]);
            return { prev, tempId };
        },
        onError: (_err, _vars, ctx) => {
            if (ctx?.prev) qc.setQueryData(beanKeys.all(userId), ctx.prev);
        },
        onSuccess: (realBean, _vars, ctx) => {
            const tempId = ctx?.tempId;
            qc.setQueryData<Bean[]>(beanKeys.all(userId), (old = []) => replaceOptimisticBean(old, realBean, tempId));
            qc.setQueryData(beanKeys.detail(realBean.id), realBean);
            if (tempId) qc.removeQueries({ queryKey: beanKeys.detail(tempId) });
        },
    });
};

export const useUpdateBean = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: beanApi.update,
        onMutate: async ({ id, ...patch }) => {
            await qc.cancelQueries({ queryKey: beanKeys.all(userId) });
            await qc.cancelQueries({ queryKey: beanKeys.detail(id) });
            const prevList = qc.getQueryData<Bean[]>(beanKeys.all(userId));
            const prevDetail = qc.getQueryData<Bean>(beanKeys.detail(id));
            qc.setQueryData<Bean[]>(beanKeys.all(userId), (old = []) =>
                old.map((b) => (b.id === id ? { ...b, ...patch } : b)),
            );
            if (prevDetail) qc.setQueryData<Bean>(beanKeys.detail(id), { ...prevDetail, ...patch });
            return { prevList, prevDetail };
        },
        onError: (_err, { id }, ctx) => {
            if (ctx?.prevList) qc.setQueryData(beanKeys.all(userId), ctx.prevList);
            if (ctx?.prevDetail) qc.setQueryData(beanKeys.detail(id), ctx.prevDetail);
        },
        onSuccess: (updated) => {
            qc.setQueryData<Bean[]>(beanKeys.all(userId), (old = []) =>
                old.map((b) => (b.id === updated.id ? updated : b)),
            );
            qc.setQueryData(beanKeys.detail(updated.id), updated);
        },
    });
};

export const useDeleteBean = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: beanApi.delete,
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: beanKeys.all(userId) });
            const prev = qc.getQueryData<Bean[]>(beanKeys.all(userId));
            qc.setQueryData<Bean[]>(beanKeys.all(userId), (old = []) => old.filter((b) => b.id !== id));
            return { prev };
        },
        onError: (_err, _id, ctx) => {
            if (ctx?.prev) qc.setQueryData(beanKeys.all(userId), ctx.prev);
        },
        onSuccess: (_data, id) => {
            qc.removeQueries({ queryKey: beanKeys.detail(id) });
            qc.removeQueries({ queryKey: [...inventoryQueryRoots.beanStockEvents, id] });
            qc.removeQueries({ queryKey: [...inventoryQueryRoots.beanStockSummary, id] });
        },
    });
};
