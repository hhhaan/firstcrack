import { getDateFnsLocale, i18n } from '@shared/i18n';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { format } from 'date-fns';

export type ViewMode = 'day' | 'week' | 'month';

export const toDateKey = (d: Date): string => format(d, 'yyyy-MM-dd');

export const toFullDisplayDate = (d: Date): string =>
    format(d, i18n.t('schedule.dateFormat'), { locale: getDateFnsLocale() });

export const batchProgress = (b: PlanBatchWithProgress) => `${b.completed_sessions}/${b.batch_count}`;

export type BatchStatus = 'pending' | 'in-progress' | 'done' | 'skipped';

export const batchStatus = (b: PlanBatchWithProgress): BatchStatus => {
    if (b.status === 'done' || b.status === 'skipped') return b.status;
    if (b.completed_sessions >= b.batch_count) return 'done';
    if (b.completed_sessions > 0) return 'in-progress';
    return 'pending';
};

/** Virtual recurring instance — computed at render time, not a DB row (id is `ruleId:originalDate`). */
export const isVirtualPlanBatch = (batch: PlanBatchWithProgress): boolean =>
    Boolean(batch.recurrence_rule_id && batch.id.includes(':'));

export const getRecurrenceLabel = (rrule: string | null): string => {
    if (!rrule) return '';
    if (rrule.includes('FREQ=DAILY')) return 'daily';
    if (rrule.includes('FREQ=WEEKLY')) {
        if (rrule.includes('INTERVAL=2')) return 'biweekly';
        return 'weekly';
    }
    if (rrule.includes('FREQ=MONTHLY')) return 'monthly';
    return 'repeat';
};

/** Status transition materialize patch — maps batch fields + dynamic status for planBatchApi.materialize. */
export const buildMaterializePatch = (batch: PlanBatchWithProgress, status: 'in-progress' | 'done') => ({
    bean_name: batch.bean_name,
    batch_size_kg: Number(batch.batch_size_kg),
    target_roasted_kg: Number(batch.target_roasted_kg),
    machine_id: batch.machine_id,
    bean_id: batch.bean_id,
    blend_id: batch.blend_id ?? null,
    roast_profile_id: batch.roast_profile_id,
    notes: batch.notes,
    green_lot: batch.green_lot,
    batch_type: batch.batch_type,
    yield_pct: batch.yield_pct,
    status,
});

/** Fields to spread into a recurrence batch update patch. */
export const buildRecurrencePatch = (batch: PlanBatchWithProgress) => ({
    bean_id: batch.bean_id,
    blend_id: batch.blend_id ?? null,
    bean_name: batch.bean_name,
    roast_profile_id: batch.roast_profile_id,
    batch_size_kg: batch.batch_size_kg,
    target_roasted_kg: batch.target_roasted_kg,
    yield_pct: batch.yield_pct,
    notes: batch.notes,
    green_lot: batch.green_lot,
    batch_type: batch.batch_type,
});

/** Conditional meta object for recurrence-aware updateSingleBatch calls. */
export const buildRecurrenceMeta = (batch: PlanBatchWithProgress) =>
    batch.recurrence_rule_id && batch.original_date
        ? { meta: { recurrenceRuleId: batch.recurrence_rule_id, originalDate: batch.original_date } }
        : {};
