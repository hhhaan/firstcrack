import type { RecurrenceInterval } from '@shared/lib/rrule';
import { buildRRule } from '@shared/lib/rrule';
import { calcPlanBatchCount } from '@shared/lib/stock-calc';
import type { PlanBatchInsert, PlanBatchUpdate, PlanBatchWithProgress } from '@shared/types/database.types';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { dayPlanApi, dayPlanRangeApi, planBatchApi, type RecurrenceRuleMasterPatch, recurrenceRuleApi } from './api';

// ── Query keys ────────────────────────────────────────────────────────────────

export const planKeys = {
    day: (userId: string, date: string) => ['day_plan', userId, date] as const,
    batches: (planId: string) => ['plan_batches', planId] as const,
    dayBatches: (userId: string, date: string) => ['day_batches', userId, date] as const,
    rangeBatches: (userId: string, start: string, end: string) => ['range_batches', userId, start, end] as const,
    rangeSummary: (userId: string, start: string, end: string) => ['day_plan_range', userId, start, end] as const,
    recurrenceRules: (userId: string) => ['recurrence_rules', userId] as const,
    weekSummary: (userId: string, start: string, end: string) => ['week_summary', userId, start, end] as const,
    monthSummary: (userId: string, start: string, end: string) => ['month_summary', userId, start, end] as const,
};

const invalidateScheduledBatchQueries = (qc: QueryClient) => {
    qc.invalidateQueries({ queryKey: ['day_batches'] });
    qc.invalidateQueries({ queryKey: ['range_batches'] });
    qc.invalidateQueries({ queryKey: ['day_plan_range'] });
    qc.invalidateQueries({ queryKey: ['week_summary'] });
    qc.invalidateQueries({ queryKey: ['month_summary'] });
};

const patchDayBatchesCache = (
    qc: QueryClient,
    userId: string,
    date: string,
    updater: (prev: PlanBatchWithProgress[]) => PlanBatchWithProgress[],
) => {
    const key = planKeys.dayBatches(userId, date);
    const previous = qc.getQueryData<PlanBatchWithProgress[]>(key);
    if (previous) {
        qc.setQueryData(key, updater(previous));
    }
    return previous;
};

const patchPlanBatchesCache = (
    qc: QueryClient,
    planId: string,
    updater: (prev: PlanBatchWithProgress[]) => PlanBatchWithProgress[],
) => {
    const key = planKeys.batches(planId);
    const previous = qc.getQueryData<PlanBatchWithProgress[]>(key);
    if (previous) {
        qc.setQueryData(key, updater(previous));
    }
    return previous;
};

const reorderByIds = (batches: PlanBatchWithProgress[], orderedIds: string[]): PlanBatchWithProgress[] => {
    const byId = new Map(batches.map((b) => [b.id, b]));
    return orderedIds
        .map((id, index) => {
            const b = byId.get(id);
            return b ? { ...b, order_index: index } : null;
        })
        .filter((b): b is PlanBatchWithProgress => b !== null);
};

// ── Recurrence Rules ──────────────────────────────────────────────────────────

export const useRecurrenceRules = (userId: string) =>
    useQuery({
        queryKey: planKeys.recurrenceRules(userId),
        queryFn: () => recurrenceRuleApi.listActive(userId),
        enabled: !!userId,
        staleTime: Infinity,
        gcTime: Infinity,
    });

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
        mutationFn: ({ id, notes }: { id: string; notes: string }) => dayPlanApi.updateNotes(id, notes),
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

export const useDayBatches = (userId: string, date: string) =>
    useQuery({
        queryKey: planKeys.dayBatches(userId, date),
        queryFn: () => planBatchApi.listForDateRange(userId, date, date),
        enabled: !!userId && !!date,
    });

export const useRangeBatches = (userId: string, start: string, end: string) =>
    useQuery({
        queryKey: planKeys.rangeBatches(userId, start, end),
        queryFn: () => planBatchApi.listForDateRange(userId, start, end),
        enabled: !!userId && !!start && !!end,
    });

export const useCreatePlanBatch = (planId: string, userId: string, date: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (batch: PlanBatchInsert) => planBatchApi.create(batch),
        onMutate: async (batch) => {
            await qc.cancelQueries({ queryKey: planKeys.batches(planId) });
            await qc.cancelQueries({ queryKey: planKeys.dayBatches(userId, date) });
            const previousPlanBatches = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.batches(planId));
            const previousDayBatches = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.dayBatches(userId, date));
            const now = new Date().toISOString();
            const orderIndex = batch.order_index ?? previousDayBatches?.length ?? previousPlanBatches?.length ?? 0;
            const optimistic: PlanBatchWithProgress = {
                id: `__optimistic__${Date.now()}`,
                plan_id: batch.plan_id,
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
            patchPlanBatchesCache(qc, planId, (prev) => [...prev, optimistic]);
            patchDayBatchesCache(qc, userId, date, (prev) => [...prev, optimistic]);
            return { previousPlanBatches, previousDayBatches };
        },
        onError: (_err, _batch, context) => {
            if (context?.previousPlanBatches) {
                qc.setQueryData(planKeys.batches(planId), context.previousPlanBatches);
            }
            if (context?.previousDayBatches) {
                qc.setQueryData(planKeys.dayBatches(userId, date), context.previousDayBatches);
            }
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: planKeys.batches(planId) });
            invalidateScheduledBatchQueries(qc);
        },
    });
};

export const useUpdatePlanBatch = (planId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (update: PlanBatchUpdate) => planBatchApi.updateSingle(update.id, update),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: planKeys.batches(planId) });
            invalidateScheduledBatchQueries(qc);
        },
    });
};

export const useDeletePlanBatch = (planId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => planBatchApi.deleteSingle(id),
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

            let previousCurrentPlan: PlanBatchWithProgress[] | undefined;

            if (currentPlanId) {
                await qc.cancelQueries({ queryKey: planKeys.batches(currentPlanId) });
                previousCurrentPlan = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.batches(currentPlanId));
            }

            await qc.cancelQueries({ queryKey: planKeys.dayBatches(userId, dtstartDate) });
            const previousDayBatches = qc.getQueryData<PlanBatchWithProgress[]>(
                planKeys.dayBatches(userId, dtstartDate),
            );

            const batchSize = Number(baseBatch.batch_size_kg) || 0;
            const targetKg = Number(baseBatch.target_roasted_kg) || 0;
            const batchCount = calcPlanBatchCount(targetKg, batchSize, baseBatch.yield_pct ?? 1);
            const orderIndex = baseBatch.order_index ?? previousDayBatches?.length ?? previousCurrentPlan?.length ?? 0;

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

            if (currentPlanId) {
                patchPlanBatchesCache(qc, currentPlanId, (prev) => [...prev, optimistic]);
            }
            patchDayBatchesCache(qc, userId, dtstartDate, (prev) => [...prev, optimistic]);

            return { previousCurrentPlan, previousDayBatches, dtstartDate };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousCurrentPlan && currentPlanId) {
                qc.setQueryData(planKeys.batches(currentPlanId), context.previousCurrentPlan);
            }
            if (context?.previousDayBatches && context.dtstartDate) {
                qc.setQueryData(planKeys.dayBatches(userId, context.dtstartDate), context.previousDayBatches);
            }
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ['plan_batches'] });
            qc.invalidateQueries({ queryKey: ['day_plan', userId] });
            qc.invalidateQueries({ queryKey: ['day_plan_range', userId] });
            qc.invalidateQueries({ queryKey: ['recurrence_rules', userId] });
            invalidateScheduledBatchQueries(qc);
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
            if (scheduleContext && context?.previousDayBatches) {
                qc.setQueryData(
                    planKeys.dayBatches(scheduleContext.userId, scheduleContext.date),
                    context.previousDayBatches,
                );
            }
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ['plan_batches'] });
            qc.invalidateQueries({ queryKey: ['day_plan_range'] });
            qc.invalidateQueries({ queryKey: ['recurrence_rules'] });
            invalidateScheduledBatchQueries(qc);
        },
    });
};

export const useDeleteFromThis = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ ruleId, fromDate }: { ruleId: string; fromDate: string }) =>
            planBatchApi.deleteFromThis(ruleId, fromDate),
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ['recurrence_rules'] });
            qc.invalidateQueries({ queryKey: ['day_plan_range'] });
            invalidateScheduledBatchQueries(qc);
        },
    });
};

export const useDeleteAllBatches = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (ruleId: string) => planBatchApi.deleteAll(ruleId),
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ['recurrence_rules'] });
            qc.invalidateQueries({ queryKey: ['day_plan_range'] });
            invalidateScheduledBatchQueries(qc);
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
        onMutate: async ({ id, patch, meta }) => {
            if (meta?.recurrenceRuleId) return; // recurring exception → complex, skip optimistic
            await qc.cancelQueries({ queryKey: ['plan_batches'] });
            const previousBatches = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.batches(patch.plan_id ?? ''));
            if (previousBatches) {
                qc.setQueryData(
                    planKeys.batches(patch.plan_id ?? ''),
                    previousBatches.map((b) => (b.id === id ? { ...b, ...patch } : b)),
                );
            }
            return { previousBatches };
        },
        onError: (_err, { patch }, context) => {
            if (context?.previousBatches && patch.plan_id) {
                qc.setQueryData(planKeys.batches(patch.plan_id), context.previousBatches);
            }
        },
        onSettled: (_data, _error, vars) => {
            // Invalidate the specific day plan if possible, otherwise range
            if (vars.patch.plan_id) {
                qc.invalidateQueries({ queryKey: planKeys.batches(vars.patch.plan_id) });
            }
            qc.invalidateQueries({ queryKey: ['day_plan_range'] });
            qc.invalidateQueries({ queryKey: ['recurrence_rules'] });
            invalidateScheduledBatchQueries(qc);
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
            qc.invalidateQueries({ queryKey: ['recurrence_rules'] });
            qc.invalidateQueries({ queryKey: ['day_plan_range'] });
            invalidateScheduledBatchQueries(qc);
        },
    });
};

export const useUpdateAllBatches = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ ruleId, patch }: { ruleId: string; patch: RecurrenceRuleMasterPatch }) =>
            planBatchApi.updateAll(ruleId, patch),
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ['recurrence_rules'] });
            qc.invalidateQueries({ queryKey: ['day_plan_range'] });
            invalidateScheduledBatchQueries(qc);
        },
    });
};

export const useReorderPlanBatches = ({ userId, date, planId }: { userId: string; date: string; planId: string }) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (orderedIds: string[]) => planBatchApi.reorder(planId, orderedIds),
        onMutate: async (orderedIds) => {
            await qc.cancelQueries({ queryKey: planKeys.batches(planId) });
            await qc.cancelQueries({ queryKey: planKeys.dayBatches(userId, date) });

            const previousPlanBatches = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.batches(planId));
            const previousDayBatches = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.dayBatches(userId, date));

            if (previousPlanBatches) {
                qc.setQueryData(planKeys.batches(planId), reorderByIds(previousPlanBatches, orderedIds));
            }
            if (previousDayBatches) {
                qc.setQueryData(planKeys.dayBatches(userId, date), reorderByIds(previousDayBatches, orderedIds));
            }

            return { previousPlanBatches, previousDayBatches };
        },
        onError: (_err, _orderedIds, context) => {
            if (context?.previousPlanBatches) {
                qc.setQueryData(planKeys.batches(planId), context.previousPlanBatches);
            }
            if (context?.previousDayBatches) {
                qc.setQueryData(planKeys.dayBatches(userId, date), context.previousDayBatches);
            }
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: planKeys.batches(planId) });
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
