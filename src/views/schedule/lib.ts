import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { format } from 'date-fns';

export type ViewMode = 'day' | 'week' | 'month';

export const toDateKey = (d: Date): string => format(d, 'yyyy-MM-dd');

export type BatchStatus = 'pending' | 'in-progress' | 'done' | 'skipped';

export const batchStatus = (b: PlanBatchWithProgress): BatchStatus => {
    if (b.status === 'done' || b.status === 'skipped') return b.status;
    if (b.completed_sessions >= b.batch_count) return 'done';
    if (b.completed_sessions > 0) return 'in-progress';
    return 'pending';
};

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
