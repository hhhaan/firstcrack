import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { dayPlanApi, dayPlanRangeApi, planBatchApi, recurrenceRuleApi, type RecurrenceRuleMasterPatch } from './api';
import type { PlanBatchInsert, PlanBatchUpdate, PlanBatchWithProgress } from '@shared/types/database.types';
import type { RecurrenceInterval } from '@shared/lib/rrule';
import { buildRRule } from '@shared/lib/rrule';

// ── Query keys ────────────────────────────────────────────────────────────────

export const planKeys = {
    day: (userId: string, date: string) => ['day_plan', userId, date] as const,
    batches: (planId: string) => ['plan_batches', planId] as const,
    dayBatches: (userId: string, date: string) => ['day_batches', userId, date] as const,
    rangeBatches: (userId: string, start: string, end: string) => ['range_batches', userId, start, end] as const,
    rangeSummary: (userId: string, start: string, end: string) => ['day_plan_range', userId, start, end] as const,
    dateSummary: (userId: string, start: string, end: string) => ['date_summary', userId, start, end] as const,
    recurrenceRules: (userId: string) => ['recurrence_rules', userId] as const,
};

const invalidateScheduledBatchQueries = (qc: QueryClient) => {
    qc.invalidateQueries({ queryKey: ['day_batches'] });
    qc.invalidateQueries({ queryKey: ['range_batches'] });
    qc.invalidateQueries({ queryKey: ['day_plan_range'] });
    qc.invalidateQueries({ queryKey: ['date_summary'] });
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
                rrule: batch.rrule ?? null,
                recurrence_group_id: batch.recurrence_group_id ?? null,
                recurrence_rule_id: batch.recurrence_rule_id ?? null,
                scheduled_date: null,
                original_date: null,
                exception_type: null,
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
        onMutate: async ({ baseBatch, interval }) => {
            const rruleStr = buildRRule(interval);

            // Optimistically add a batch to the current plan's cache
            let previousCurrentPlan: PlanBatchWithProgress[] | undefined;
            if (currentPlanId) {
                await qc.cancelQueries({ queryKey: planKeys.batches(currentPlanId) });
                previousCurrentPlan = qc.getQueryData<PlanBatchWithProgress[]>(planKeys.batches(currentPlanId));

                const optimistic: PlanBatchWithProgress = {
                    id: `__optimistic__${Date.now()}`,
                    plan_id: currentPlanId,
                    bean_name: baseBatch.bean_name,
                    bean_id: baseBatch.bean_id ?? null,
                    batch_type: baseBatch.batch_type ?? '',
                    batch_size_kg: baseBatch.batch_size_kg,
                    target_roasted_kg: baseBatch.target_roasted_kg,
                    batch_count: Math.ceil(baseBatch.target_roasted_kg / baseBatch.batch_size_kg),
                    yield_pct: baseBatch.yield_pct ?? 1,
                    order_index: baseBatch.order_index ?? (previousCurrentPlan?.length ?? 0),
                    machine_id: baseBatch.machine_id ?? null,
                    roast_profile_id: baseBatch.roast_profile_id ?? null,
                    rrule: rruleStr,
                    recurrence_group_id: null,
                    recurrence_rule_id: null,
                    scheduled_date: null,
                    original_date: null,
                    exception_type: null,
                    notes: baseBatch.notes ?? '',
                    green_lot: baseBatch.green_lot ?? '',
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    completed_sessions: 0,
                };

                qc.setQueryData(
                    planKeys.batches(currentPlanId),
                    [...(previousCurrentPlan ?? []), optimistic],
                );
            }

            return { previousCurrentPlan };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousCurrentPlan && currentPlanId) {
                qc.setQueryData(planKeys.batches(currentPlanId), context.previousCurrentPlan);
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
export const useDeleteSingleBatch = () => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, meta }: { id: string; meta?: { recurrenceRuleId?: string; originalDate?: string; planId?: string } }) =>
            planBatchApi.deleteSingle(id, meta),
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
        mutationFn: ({ id, patch, meta }: { id: string; patch: PlanBatchUpdate; meta?: { recurrenceRuleId?: string; originalDate?: string } }) =>
            planBatchApi.updateSingle(id, patch, meta),
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
        queryKey: planKeys.dateSummary(userId, start, end),
        queryFn: () => dayPlanRangeApi.listSummaryForDateRange(userId, start, end),
        enabled: !!userId,
        staleTime: 30_000,
    });
};

export const useWeekSummary = (userId: string, weekStart: Date) => {
    const start = format(startOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const end = format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    return useQuery({
        queryKey: planKeys.dateSummary(userId, start, end),
        queryFn: () => dayPlanRangeApi.listSummaryForDateRange(userId, start, end),
        enabled: !!userId,
        staleTime: 30_000,
    });
};