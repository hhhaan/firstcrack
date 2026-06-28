import type { RecurrenceInterval } from '@shared/lib/rrule';

export type BatchType = 'Single Origin' | 'Pre-roast Blend' | 'Post-roast Blend';

export type EditScope = 'single' | 'from_this' | 'all';

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

export const DEFAULT_YIELD = 82;
export const DEFAULT_BATCH_SIZE = 25;

export const RECURRENCE_OPTIONS: { value: RecurrenceInterval }[] = [
    { value: 'daily' },
    { value: 'weekly' },
    { value: 'biweekly' },
    { value: 'monthly' },
];
