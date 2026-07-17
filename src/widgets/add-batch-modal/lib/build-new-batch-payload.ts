import type { RecurrenceInterval } from '@shared/lib/rrule';
import type { BatchType, NewBatchData } from './types';

export type BuildNewBatchPayloadInput = {
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
};

/**
 * Assemble NewBatchData for AddBatchModal submit (pure).
 * Blend types clear beanId; single origin clears blendId.
 */
export const buildNewBatchPayload = (input: BuildNewBatchPayloadInput): NewBatchData => {
    const isBlendType = input.batchType === 'Pre-roast Blend' || input.batchType === 'Post-roast Blend';
    return {
        date: input.date,
        machineId: input.machineId,
        machineName: input.machineName,
        batchType: input.batchType,
        profileId: input.profileId,
        profileName: input.profileName,
        beanId: isBlendType ? null : input.beanId || null,
        blendId: isBlendType ? input.blendId || null : null,
        beanName: input.beanName,
        targetRoasted: input.targetRoasted,
        batchSize: input.batchSize,
        yieldPct: input.yieldPct,
        batchCount: input.batchCount,
        greenNeeded: input.greenNeeded,
        greenLot: input.greenLot,
        notes: input.notes,
        recurringInterval: input.recurringInterval ?? undefined,
    };
};
