import { calcPlanBatchCount } from '@shared/lib/stock-calc';
import { supabase } from '@shared/lib/supabase';
import type { PlanBatch, PlanBatchWithProgress } from '@shared/types/database.types';
import { recurrenceRuleApi } from './recurrence-rule';

/**
 * List batches for a date range, merging recurrence rules with exception rows.
 * This is the rendering-time entry point — computes instances on the fly.
 */
export async function listForDateRange(
    userId: string,
    startDate: string,
    endDate: string,
): Promise<PlanBatchWithProgress[]> {
    // Independent lookups — one-off batches need plan ids; session counts need batch ids.
    const [rules, plansResult, exceptionsResult] = await Promise.all([
        recurrenceRuleApi.listActive(userId),
        supabase
            .from('roast_day_plans')
            .select('id, date')
            .eq('user_id', userId)
            .gte('date', startDate)
            .lte('date', endDate),
        supabase
            .from('roast_plan_batches')
            .select('*')
            .not('recurrence_rule_id', 'is', null)
            .gte('scheduled_date', startDate)
            .lte('scheduled_date', endDate),
    ]);
    const { data: plans, error: plansError } = plansResult;
    if (plansError) throw plansError;
    const { data: exceptions, error: exceptionsError } = exceptionsResult;
    if (exceptionsError) throw exceptionsError;

    const dateToPlanId = new Map((plans ?? []).map((p) => [p.date, p.id]));
    const planIdToDate = new Map((plans ?? []).map((p) => [p.id, p.date]));
    const planIds = (plans ?? []).map((p) => p.id);

    // One-off batches need plan ids from the day-plan lookup above.
    let oneOffBatches: PlanBatch[] = [];
    if (planIds.length > 0) {
        const oneOffResult = await supabase
            .from('roast_plan_batches')
            .select('*')
            .is('recurrence_rule_id', null)
            .in('plan_id', planIds);
        if (oneOffResult.error) throw oneOffResult.error;
        oneOffBatches = oneOffResult.data ?? [];
    }

    // Sessions for progress — scoped to concrete batch ids only (no full-table scan)
    const batchIds = [...(exceptions ?? []), ...(oneOffBatches ?? [])].map((b) => b.id);
    const sessionCountMap = new Map<string, number>();
    if (batchIds.length > 0) {
        const { data: sessions, error: sessionsError } = await supabase
            .from('roast_sessions')
            .select('plan_batch_id')
            .in('plan_batch_id', batchIds);
        if (sessionsError) throw sessionsError;
        for (const s of sessions ?? []) {
            if (s.plan_batch_id) {
                sessionCountMap.set(s.plan_batch_id, (sessionCountMap.get(s.plan_batch_id) ?? 0) + 1);
            }
        }
    }

    // Build result from one-off batches.
    // One-off rows never store scheduled_date (recurrence-exception column) —
    // derive it from the owning plan's date so date-keyed consumers see them.
    const result: PlanBatchWithProgress[] = (oneOffBatches ?? []).map((row) => ({
        ...row,
        scheduled_date: row.scheduled_date ?? planIdToDate.get(row.plan_id) ?? null,
        completed_sessions: sessionCountMap.get(row.id) ?? 0,
    }));

    // 5. For each active recurrence rule, expand and merge with exceptions
    const rangeStart = new Date(`${startDate}T00:00:00`);
    const rangeEnd = new Date(`${endDate}T23:59:59`);

    // Dynamic import to avoid circular dependency
    const { expandRRuleInRange, mergeRecurrenceExceptions } = await import('@shared/lib/rrule');

    for (const rule of rules) {
        if (rule.status !== 'active') continue;

        // Check if rule is within range
        const ruleStart = new Date(`${rule.dtstart}T00:00:00`);
        if (rule.until && new Date(`${rule.until}T23:59:59`) < rangeStart) continue;

        // Expand dates in range
        const expandedDates = expandRRuleInRange(
            rule.rrule,
            ruleStart,
            rangeStart,
            rule.until ? new Date(`${rule.until}T23:59:59`) : rangeEnd,
        );

        // Filter exceptions for this rule
        const ruleExceptions = (exceptions ?? [])
            .filter((ex) => ex.recurrence_rule_id === rule.id)
            .map((ex) => ({
                original_date: ex.original_date ?? '',
                scheduled_date: ex.scheduled_date ?? '',
                exception_type: ex.exception_type as 'modified' | 'cancelled',
                batch_size_kg: ex.batch_size_kg,
                target_roasted_kg: ex.target_roasted_kg,
                bean_id: ex.bean_id,
                bean_name: ex.bean_name,
                machine_id: ex.machine_id,
                roast_profile_id: ex.roast_profile_id,
                notes: ex.notes,
                status: ex.status,
            }));

        // Merge
        const instances = mergeRecurrenceExceptions(expandedDates, ruleExceptions);

        // For each instance, get or create the day plan and produce a batch-like row
        for (const instance of instances) {
            if (instance.exceptionType === 'cancelled') continue;

            if (instance.exceptionType === 'modified' && instance.exception) {
                // Scope to this rule — the exceptions query is every rule in the range.
                const exBatch = exceptions?.find(
                    (e) => e.recurrence_rule_id === rule.id && e.original_date === instance.originalDate,
                );
                if (exBatch) {
                    result.push({
                        ...exBatch,
                        // Exception rows may not store rrule; use master rule
                        rrule: exBatch.rrule ?? rule.rrule,
                        // ponytail: null on the row keeps the series profile. A one-off clear
                        // does not stick until the row stores an explicit clear.
                        roast_profile_id: exBatch.roast_profile_id ?? rule.roast_profile_id,
                        completed_sessions: sessionCountMap.get(exBatch.id) ?? 0,
                    });
                }
            } else if (instance.exceptionType === 'normal') {
                const planId = dateToPlanId.get(instance.date) ?? '';
                const sameDayRow = (exceptions ?? []).find(
                    (e) =>
                        e.recurrence_rule_id === rule.id &&
                        e.exception_type !== 'cancelled' &&
                        e.original_date === instance.originalDate,
                );

                const batchSize = Number(rule.batch_size_kg) || 0;
                const targetKg = Number(rule.target_roasted_kg) || 0;
                const batchCount = calcPlanBatchCount(targetKg, batchSize, Number(rule.yield_pct) || 1);

                result.push({
                    id: `${rule.id}:${instance.originalDate}`,
                    plan_id: planId,
                    bean_name: rule.bean_name,
                    bean_id: rule.bean_id,
                    blend_id: rule.blend_id ?? null,
                    batch_type: rule.batch_type,
                    batch_size_kg: rule.batch_size_kg,
                    target_roasted_kg: rule.target_roasted_kg,
                    batch_count: batchCount,
                    yield_pct: rule.yield_pct,
                    order_index: 0,
                    machine_id: rule.machine_id,
                    roast_profile_id: rule.roast_profile_id ?? sameDayRow?.roast_profile_id ?? null,
                    rrule: rule.rrule,
                    recurrence_group_id: null,
                    recurrence_rule_id: rule.id,
                    scheduled_date: instance.date,
                    original_date: instance.originalDate,
                    exception_type: null,
                    notes: rule.notes,
                    green_lot: rule.green_lot,
                    status: 'pending',
                    created_at: rule.created_at,
                    updated_at: rule.updated_at,
                    completed_sessions: 0,
                });
            }
        }
    }

    return result.sort((a, b) => a.order_index - b.order_index || a.bean_name.localeCompare(b.bean_name));
}
