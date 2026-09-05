import type { RecurrenceInterval } from '@shared/lib/rrule';

export type BatchType = 'Single Origin' | 'Pre-roast Blend' | 'Post-roast Blend';

/** Recurring batch edit/delete reach — one instance, this and later, or the whole rule. */
export type EditScope = 'single' | 'from_this' | 'all';

/** Add/Edit batch form payload — the input every Plan Day write takes. */
export interface NewBatchData {
    date: Date;
    machineId: string;
    machineName: string;
    batchType: BatchType;
    profileId: string | null;
    profileName: string;
    beanId: string | null;
    blendId: string | null;
    beanName: string;
    targetRoasted: number;
    batchSize: number;
    yieldPct: number;
    batchCount: number;
    greenNeeded: number;
    greenLot: string;
    notes: string;
    recurringInterval?: RecurrenceInterval | null;
}
