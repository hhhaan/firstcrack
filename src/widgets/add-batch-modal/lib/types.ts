import type { BatchType, EditScope, NewBatchData } from '@features/schedule';
import type { RecurrenceInterval } from '@shared/lib/rrule';

// Form types are owned by features/schedule (the write side); re-exported for the modal's callers.
export type { BatchType, EditScope, NewBatchData };

export const DEFAULT_YIELD = 82;
export const DEFAULT_BATCH_SIZE = 25;

export const RECURRENCE_OPTIONS: { value: RecurrenceInterval }[] = [
    { value: 'daily' },
    { value: 'weekly' },
    { value: 'biweekly' },
    { value: 'monthly' },
];
