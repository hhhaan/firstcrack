import { parseRruleToInterval } from '@shared/lib/rrule';
import { format } from 'date-fns';

export type { BatchStatus } from '@entities/plan';
export { batchStatus } from '@entities/plan';

export type ViewMode = 'day' | 'week' | 'month';

export const toDateKey = (d: Date): string => format(d, 'yyyy-MM-dd');

export const getRecurrenceLabel = (rrule: string | null): string => {
    if (!rrule) return '';
    return parseRruleToInterval(rrule) ?? 'repeat';
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
