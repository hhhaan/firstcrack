import { inventoryQueryRoots, planQueryRoots } from '@shared/lib/query-keys';
import type { RecurrenceInterval } from '@shared/lib/rrule';
import { buildRRule } from '@shared/lib/rrule';
import { calcPlanBatchCount } from '@shared/lib/stock-calc';
import type { PlanBatchInsert, PlanBatchUpdate, PlanBatchWithProgress } from '@shared/types/database.types';
import { type QueryClient, type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays } from 'date-fns';
import { dayPlanApi, dayPlanRangeApi, planBatchApi, type RecurrenceRuleMasterPatch } from './api';

// ── Query keys ────────────────────────────────────────────────────────────────

export const planKeys = {
    dayRoot: planQueryRoots.day,
    dayBatchesRoot: planQueryRoots.dayBatches,
    rangeBatchesRoot: planQueryRoots.rangeBatches,
    weekSummaryRoot: planQueryRoots.weekSummary,
    monthSummaryRoot: planQueryRoots.monthSummary,
    day: (userId: string, date: string) => [...planQueryRoots.day, userId, date] as const,
    dayBatches: (userId: string, date: string, lookbackDays?: number) =>
        lookbackDays && lookbackDays > 0
            ? ([...planQueryRoots.dayBatches, userId, date, lookbackDays] as const)
            : ([...planQueryRoots.dayBatches, userId, date] as const),
    weekSummary: (userId: string, start: string, end: string) =>
        [...planQueryRoots.weekSummary, userId, start, end] as const,
    monthSummary: (userId: string, start: string, end: string) =>
        [...planQueryRoots.monthSummary, userId, start, end] as const,
};

/** Keys invalidated after plan batch mutations (staleTime Infinity → must not omit). */
export const scheduledBatchInvalidationKeys = () =>
    [
        planKeys.dayBatchesRoot,
        planKeys.rangeBatchesRoot,
        planKeys.weekSummaryRoot,
        planKeys.monthSummaryRoot,
        inventoryQueryRoots.beanStockSummaries,
        inventoryQueryRoots.beanStockSummary,
    ] as const;

export const invalidateScheduledBatchQueries = (qc: QueryClient) => {
    for (const queryKey of scheduledBatchInvalidationKeys()) {
        void qc.invalidateQueries({ queryKey });
    }
};

export const invalidatePlanScope = (qc: QueryClient, userId?: string) => {
    void qc.invalidateQueries({ queryKey: userId ? [...planQueryRoots.day, userId] : planKeys.dayRoot });
    invalidateScheduledBatchQueries(qc);
};

/** Mirrors useCreatePlanBatch onSettled invalidation (for regression tests). */
export const invalidateAfterCreatePlanBatch = (qc: QueryClient) => {
    invalidateScheduledBatchQueries(qc);
};

/** Rollback snapshot of every cached dayBatches variant (with/without lookback). */
type DayBatchesSnapshot = Array<[QueryKey, PlanBatchWithProgress[] | undefined]>;

/** Exported for regression tests — optimistic patch must hit lookback key variants. */
export const patchDayBatchesCache = (
    qc: QueryClient,
    userId: string,
    date: string,
    updater: (prev: PlanBatchWithProgress[]) => PlanBatchWithProgress[],
): DayBatchesSnapshot => {
    // Prefix key — matches both dayBatches(userId, date) and lookback variants (…, 14).
    const prefix = planKeys.dayBatches(userId, date);
    const previous = qc.getQueriesData<PlanBatchWithProgress[]>({ queryKey: prefix });
    qc.setQueriesData<PlanBatchWithProgress[]>({ queryKey: prefix }, (prev) => (prev ? updater(prev) : prev));
    return previous;
};

export const restoreDayBatchesCache = (qc: QueryClient, snapshot: DayBatchesSnapshot | undefined) => {
    for (const [key, data] of snapshot ?? []) {
        qc.setQueryData(key, data);
    }
};

/**
 * Apply a new one-off order to cached rows (exported for regression tests).
 * Listed ids get 1-based order_index — 0 is pinned for recurring instances.
 * Unlisted rows (other days in a range cache, recurring rows) are preserved,
 * then everything is re-sorted with the listForDateRange comparator.
 */
export const reorderByIds = (batches: PlanBatchWithProgress[], orderedIds: string[]): PlanBatchWithProgress[] => {
    const pos = new Map(orderedIds.map((id, index) => [id, index + 1]));
    return batches
        .map((b) => {
            const next = pos.get(b.id);
            return next === undefined ? b : { ...b, order_index: next };
        })
        .sort((a, b) => a.order_index - b.order_index || a.bean_name.localeCompare(b.bean_name));
};

// ── Day Plan ──────────────────────────────────────────────────────────────────

export const useDayPlan = (userId: string, date: string) => {
    // Opening a day is a read. The day row is inserted by the batch-add paths that call getOrCreate.
    return useQuery({
        queryKey: planKeys.day(userId, date),
        queryFn: () => dayPlanApi.get(userId, date),
        enabled: !!userId && !!date,
        staleTime: 60_000,
    });
};

// ── Plan Batches ──────────────────────────────────────────────────────────────

/** Same read as `useDayBatches`. Callers fetch this instead of defining `listForDateRange`. */
export const dayBatchesQuery = (userId: string, date: string, lookbackDays?: number) => {
    const range = lookbackDays && lookbackDays > 0;
    const start = range ? format(subDays(new Date(`${date}T00:00:00`), lookbackDays), 'yyyy-MM-dd') : date;
    return {
        queryKey: planKeys.dayBatches(userId, date, lookbackDays),
        queryFn: () => planBatchApi.listForDateRange(userId, start, date),
    };
};

export const useDayBatches = (userId: string, date: string, lookbackDays?: number) =>
    useQuery({
        ...dayBatchesQuery(userId, date, lookbackDays),
        enabled: !!userId && !!date && !Number.isNaN(Date.parse(date)),
    });

export const useCreatePlanBatch = (planId: string, userId: string, date: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (batch: PlanBatchInsert) => planBatchApi.create(batch),
        onMutate: async (batch) => {
            await qc.cancelQueries({ queryKey: planKeys.dayBatches(userId, date) });
            const now = new Date().toISOString();
            const orderIndex = batch.order_index ?? 0;
            const optimistic: PlanBatchWithProgress = {
                id: `__optimistic__${Date.now()}`,
                plan_id: batch.plan_id ?? planId,
                bean_name: batch.bean_name,
                bean_id: batch.bean_id ?? null,
                blend_id: batch.blend_id ?? null,
                batch_type: batch.batch_type ?? '',
                batch_size_kg: batch.batch_size_kg,
                target_roasted_kg: batch.target_roasted_kg,
                batch_count: calcPlanBatchCount(batch.target_roasted_kg, batch.batch_size_kg, batch.yield_pct ?? 1),
                yield_pct: batch.yield_pct ?? 1,
                order_index: orderIndex,
                machine_id: batch.machine_id ?? null,
                roast_profile_id: batch.roast_profile_id ?? null,
                rrule: batch.rrule ?? null,
                recurrence_group_id: batch.recurrence_group_id ?? null,
                recurrence_rule_id: batch.recurrence_rule_id ?? null,
                scheduled_date: date,
                original_date: null,
                exception_type: null,
                notes: batch.notes ?? '',
                green_lot: batch.green_lot ?? '',
                status: batch.status ?? 'pending',
                created_at: now,
                updated_at: now,
                completed_sessions: 0,
            };
            const previousDayBatches = patchDayBatchesCache(qc, userId, date, (prev) => [...prev, optimistic]);
            return { previousDayBatches };
        },
        onError: (_err, _batch, context) => {
            restoreDayBatchesCache(qc, context?.previousDayBatches);
        },
        onSettled: () => {
            invalidateScheduledBatchQueries(qc);
        },
    });
};

// ── Recurring Batches ─────────────────────────────────────────────────────────

export const useCreateRecurringBatches = (userId: string, currentPlanId?: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            baseBatch,
            interval,
            dtstart,
        }: {
            baseBatch: Omit<PlanBatchInsert, 'plan_id'>;
            interval: RecurrenceInterval;
            dtstart: Date;
        }) => {
            const rruleStr = buildRRule(interval);
            return planBatchApi.createRecurring(baseBatch, rruleStr, dtstart, userId);
        },
        onMutate: async ({ baseBatch, interval, dtstart }) => {
            const rruleStr = buildRRule(interval);
            const dtstartDate = format(dtstart, 'yyyy-MM-dd');
            const optimisticId = `__optimistic__${Date.now()}`;

            await qc.cancelQueries({ queryKey: planKeys.dayBatches(userId, dtstartDate) });

            const batchSize = Number(baseBatch.batch_size_kg) || 0;
            const targetKg = Number(baseBatch.target_roasted_kg) || 0;
            const batchCount = calcPlanBatchCount(targetKg, batchSize, baseBatch.yield_pct ?? 1);
            const orderIndex = baseBatch.order_index ?? 0;

            const optimistic: PlanBatchWithProgress = {
                id: `${optimisticId}:${dtstartDate}`,
                plan_id: currentPlanId ?? '',
                bean_name: baseBatch.bean_name,
                bean_id: baseBatch.bean_id ?? null,
                blend_id: baseBatch.blend_id ?? null,
                batch_type: baseBatch.batch_type ?? '',
                batch_size_kg: baseBatch.batch_size_kg,
                target_roasted_kg: baseBatch.target_roasted_kg,
                batch_count: batchCount,
                yield_pct: baseBatch.yield_pct ?? 1,
                order_index: orderIndex,
                machine_id: baseBatch.machine_id ?? null,
                roast_profile_id: baseBatch.roast_profile_id ?? null,
                rrule: rruleStr,
                recurrence_group_id: null,
                recurrence_rule_id: optimisticId,
                scheduled_date: dtstartDate,
                original_date: dtstartDate,
                exception_type: null,
                notes: baseBatch.notes ?? '',
                green_lot: baseBatch.green_lot ?? '',
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                completed_sessions: 0,
            };

            const previousDayBatches = patchDayBatchesCache(qc, userId, dtstartDate, (prev) => [...prev, optimistic]);

            return { previousDayBatches };
        },
        onError: (_err, _vars, context) => {
            restoreDayBatchesCache(qc, context?.previousDayBatches);
        },
        onSettled: () => {
            invalidatePlanScope(qc, userId);
        },
    });
};

/** Scope-based mutations for recurring batch editing */
export const useDeleteSingleBatch = (scheduleContext?: { userId: string; date: string }) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            id,
            meta,
        }: {
            id: string;
            meta?: { recurrenceRuleId?: string; originalDate?: string; planId?: string };
        }) => planBatchApi.deleteSingle(id, meta),
        onMutate: async ({ id }) => {
            if (!scheduleContext) return {};

            const { userId, date } = scheduleContext;
            await qc.cancelQueries({ queryKey: planKeys.dayBatches(userId, date) });
            const previousDayBatches = patchDayBatchesCache(qc, userId, date, (prev) =>
                prev.filter((b) => b.id !== id),
            );
            return { previousDayBatches };
        },
        onError: (_err, _vars, context) => {
            restoreDayBatchesCache(qc, context?.previousDayBatches);
        },
        onSettled: () => {
            invalidatePlanScope(qc);
        },
    });
};

export const useDeleteFromThis = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ ruleId, fromDate }: { ruleId: string; fromDate: string }) =>
            planBatchApi.deleteFromThis(ruleId, fromDate),
        onSettled: () => {
            invalidatePlanScope(qc);
        },
    });
};

export const useDeleteAllBatches = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (ruleId: string) => planBatchApi.deleteAll(ruleId),
        onSettled: () => {
            invalidatePlanScope(qc);
        },
    });
};

export const useUpdateSingleBatch = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            id,
            patch,
            meta,
        }: {
            id: string;
            patch: PlanBatchUpdate;
            meta?: { recurrenceRuleId?: string; originalDate?: string };
        }) => planBatchApi.updateSingle(id, patch, meta),
        onSettled: () => {
            invalidatePlanScope(qc);
        },
    });
};

export const useUpdateFromThis = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            ruleId,
            fromDate,
            patch,
        }: {
            ruleId: string;
            fromDate: string;
            patch: RecurrenceRuleMasterPatch & { userId: string };
        }) => planBatchApi.updateFromThis(ruleId, fromDate, patch),
        onSettled: () => {
            invalidatePlanScope(qc);
        },
    });
};

export const useUpdateAllBatches = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ ruleId, patch }: { ruleId: string; patch: RecurrenceRuleMasterPatch }) =>
            planBatchApi.updateAll(ruleId, patch),
        onSettled: () => {
            invalidatePlanScope(qc);
        },
    });
};

export const useReorderPlanBatches = ({ userId, date, planId }: { userId: string; date: string; planId: string }) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (orderedIds: string[]) => planBatchApi.reorder(planId, orderedIds),
        meta: { feature: 'plan-batch', rpc: 'reorder_plan_batches' },
        onMutate: async (orderedIds) => {
            await qc.cancelQueries({ queryKey: planKeys.dayBatches(userId, date) });
            const previousDayBatches = patchDayBatchesCache(qc, userId, date, (prev) => reorderByIds(prev, orderedIds));
            return { previousDayBatches };
        },
        onError: (_err, _orderedIds, context) => {
            restoreDayBatchesCache(qc, context?.previousDayBatches);
        },
        onSettled: () => {
            invalidateScheduledBatchQueries(qc);
        },
    });
};

// ── Range Summary (week / month views) ───────────────────────────────────────

export const useMonthSummary = (userId: string, year: number, month: number) => {
    const start = format(startOfMonth(new Date(year, month)), 'yyyy-MM-dd');
    const end = format(endOfMonth(new Date(year, month)), 'yyyy-MM-dd');
    return useQuery({
        queryKey: planKeys.monthSummary(userId, start, end),
        queryFn: () => dayPlanRangeApi.listSummary(userId, start, end),
        enabled: !!userId,
        staleTime: 30_000,
    });
};

export const useWeekSummary = (userId: string, weekStart: Date) => {
    const start = format(startOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const end = format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    return useQuery({
        queryKey: planKeys.weekSummary(userId, start, end),
        queryFn: () => dayPlanRangeApi.listSummary(userId, start, end),
        enabled: !!userId,
        staleTime: 30_000,
    });
};
