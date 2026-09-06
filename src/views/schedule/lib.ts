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

/** Pending/in-progress batches scheduled before today (not the selected view date). */
export const isOverdueBatch = (b: PlanBatchWithProgress, todayKey: string): boolean => {
    const status = batchStatus(b);
    return !!b.scheduled_date && b.scheduled_date < todayKey && status !== 'done' && status !== 'skipped';
};

export const getRecurrenceLabel = (rrule: string | null): string => {
    if (!rrule) return '';
    const match = rrule.match(/FREQ=([A-Z]+)/);
    const freq = match?.[1];
    if (freq === 'DAILY') return 'daily';
    if (freq === 'WEEKLY') {
        if (rrule.includes('INTERVAL=2')) return 'biweekly';
        return 'weekly';
    }
    if (freq === 'MONTHLY') return 'monthly';
    return 'repeat';
};

/** PostgrestError 등은 Error가 아니어서 String(err) → "[object Object]" 가 됨 */
export function unknownErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (
        err &&
        typeof err === 'object' &&
        'message' in err &&
        typeof (err as { message: unknown }).message === 'string'
    ) {
        return (err as { message: string }).message;
    }
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}
