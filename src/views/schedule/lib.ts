import { format } from 'date-fns';
import { getDateFnsLocale, i18n } from '@shared/i18n';
import type { PlanBatchWithProgress } from '@shared/types/database.types';

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

/** Map RRule string to human-readable label */
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
