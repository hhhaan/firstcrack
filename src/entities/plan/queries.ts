import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { dayPlanApi, dayPlanRangeApi, planBatchApi } from './api';
import type { PlanBatchInsert, PlanBatchUpdate, PlanBatchWithProgress } from '@shared/types/database.types';

// ── Query keys ────────────────────────────────────────────────────────────────

export const planKeys = {
    day: (userId: string, date: string) => ['day_plan', userId, date] as const,
    batches: (planId: string) => ['plan_batches', planId] as const,
    rangeSummary: (userId: string, start: string, end: string) => ['day_plan_range', userId, start, end] as const,
};

// ── Day Plan ──────────────────────────────────────────────────────────────────

export const useDayPlan = (userId: string, date: string) =>
    useQuery({
        queryKey: planKeys.day(userId, date),
        queryFn: () => dayPlanApi.getOrCreate(userId, date),
        enabled: !!userId && !!date,
        staleTime: 60_000,
    });

export const useUpdateDayPlanNotes = (userId: string, date: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, notes }: { id: string; notes: string }) =>
            dayPlanApi.updateNotes(id, notes),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: planKeys.day(userId, date) });
        },
    });
};

// ── Plan Batches ──────────────────────────────────────────────────────────────

export const usePlanBatches = (planId: string) =>
    useQuery({
        queryKey: planKeys.batches(planId),
        queryFn: () => planBatchApi.list(planId),
        enabled: !!planId,
        staleTime: 15_000,
    });

export const useCreatePlanBatch = (planId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (batch: PlanBatchInsert) => planBatchApi.create(batch),
        onMutate: async (batch) => {
            await qc.cancelQueries({ queryKey: planKeys.batches(planId) });
            const previousBatches = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.batches(planId));
            const now = new Date().toISOString();
            const optimistic: PlanBatchWithProgress = {
                id: `__optimistic__${Date.now()}`,
                plan_id: batch.plan_id,
                bean_name: batch.bean_name,
                bean_id: batch.bean_id ?? null,
                batch_type: batch.batch_type ?? '',
                batch_size_kg: batch.batch_size_kg,
                target_roasted_kg: batch.target_roasted_kg,
                batch_count: Math.ceil(batch.target_roasted_kg / batch.batch_size_kg),
                yield_pct: batch.yield_pct ?? 1,
                order_index: batch.order_index ?? (previousBatches?.length ?? 0),
                machine_id: batch.machine_id ?? null,
                roast_profile_id: batch.roast_profile_id ?? null,
                notes: batch.notes ?? '',
                green_lot: batch.green_lot ?? '',
                status: batch.status ?? 'pending',
                created_at: now,
                updated_at: now,
                completed_sessions: 0,
            };
            qc.setQueryData(planKeys.batches(planId), [...(previousBatches ?? []), optimistic]);
            return { previousBatches };
        },
        onError: (_err, _batch, context) => {
            if (context?.previousBatches) {
                qc.setQueryData(planKeys.batches(planId), context.previousBatches);
            }
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: planKeys.batches(planId) });
        },
    });
};

export const useUpdatePlanBatch = (planId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (update: PlanBatchUpdate) => planBatchApi.update(update),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: planKeys.batches(planId) });
        },
    });
};

export const useDeletePlanBatch = (planId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => planBatchApi.delete(id),
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: planKeys.batches(planId) });
            const previousBatches = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.batches(planId));
            qc.setQueryData(
                planKeys.batches(planId),
                (previousBatches ?? []).filter((b) => b.id !== id),
            );
            return { previousBatches };
        },
        onError: (_err, _id, context) => {
            if (context?.previousBatches) {
                qc.setQueryData(planKeys.batches(planId), context.previousBatches);
            }
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: planKeys.batches(planId) });
        },
    });
};

export const useReorderPlanBatches = (planId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (orderedIds: string[]) => planBatchApi.reorder(planId, orderedIds),
        onMutate: async (orderedIds) => {
            await qc.cancelQueries({ queryKey: planKeys.batches(planId) });
            const previousBatches = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.batches(planId));
            if (previousBatches) {
                const byId = new Map(previousBatches.map((b) => [b.id, b]));
                const optimistic = orderedIds
                    .map((id, index) => {
                        const b = byId.get(id);
                        return b ? { ...b, order_index: index } : null;
                    })
                    .filter((b): b is PlanBatchWithProgress => b !== null);
                qc.setQueryData(planKeys.batches(planId), optimistic);
            }
            return { previousBatches };
        },
        onError: (_err, _orderedIds, context) => {
            if (context?.previousBatches) {
                qc.setQueryData(planKeys.batches(planId), context.previousBatches);
            }
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: planKeys.batches(planId) });
        },
    });
};

// ── Range Summary (week / month views) ───────────────────────────────────────

export const useMonthSummary = (userId: string, year: number, month: number) => {
    const start = format(startOfMonth(new Date(year, month)), 'yyyy-MM-dd');
    const end = format(endOfMonth(new Date(year, month)), 'yyyy-MM-dd');
    return useQuery({
        queryKey: planKeys.rangeSummary(userId, start, end),
        queryFn: () => dayPlanRangeApi.listSummary(userId, start, end),
        enabled: !!userId,
        staleTime: 30_000,
    });
};

export const useWeekSummary = (userId: string, weekStart: Date) => {
    const start = format(startOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const end = format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    return useQuery({
        queryKey: planKeys.rangeSummary(userId, start, end),
        queryFn: () => dayPlanRangeApi.listSummary(userId, start, end),
        enabled: !!userId,
        staleTime: 30_000,
    });
};
