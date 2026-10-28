import type { MachineSnapshot } from '@entities/machine';
import type { PlanBatchHandoff, RoastSession } from '@shared/types/database.types';
import type { BatchTitleNumbering, LogEntry } from '@shared/types/roast';
import type { BbpCapture } from '../lib/batch-timeline';
import type { FinalizedBbp } from './bbp';

/** Injected from upload feature (composed in views) — avoids feature→feature import. */
export type SyncRoastCurve = (input: {
    sessionId: string;
    roastSessionId: string;
    ownerId: string;
    profileRequired: boolean;
    bbpRequired: boolean;
}) => Promise<unknown>;

/** Form fields required to persist a completed roast (matches summary modal). */
export type SaveRoastFormData = {
    notes: string;
    batchName?: string | null;
    /** Green input, in kg — prefilled from batch size, drives stock deduction. */
    weightGrams: number;
    /** Measured roasted output, in kg. 0/undefined = not weighed. */
    outputWeightKg?: number;
    roastLevel: string | null;
    beanId: string | null;
    blendId?: string | null;
    /**
     * Free-text bean name for sample / no-inventory roasts.
     * Stored on session.bean_label; never creates beans rows or stock events.
     */
    beanLabel?: string | null;
    /** resolved handoff for ad-hoc schedule link (from day batches) */
    linkedBatch?: PlanBatchHandoff | null;
    linkedBatchId?: string | null;
    /** When true, server deducts green in the same TX as session save (C1). */
    deductStock?: boolean;
};

export interface SaveRoastParams {
    formData: SaveRoastFormData;
    handoffBeanName: string | null;
    sessionId: string | null;
    userId: string;
    elapsed: number;
    /** Charge origin in ms. Same field persisted on pending saves. 0 → roasted_at null. */
    roastStartTime: number;
    rawBT: number | null;
    ambientTemperature?: number | null;
    ambientHumidity?: number | null;
    selectedBeanId: string | null;
    selectedBlendId?: string | null;
    targetProfileId: string | null;
    batchTitleNumbering?: BatchTitleNumbering;
    /** Word before the workspace-wide number. Captured with the pending save. */
    totalBatchPrefix?: string;
    planBatchHandoff: PlanBatchHandoff | null;
    logEntries: LogEntry[];
    machineSnapshot?: MachineSnapshot | null;
    bbpSummary?: FinalizedBbp | null;
    bbpCapture?: BbpCapture | null;
}

export interface SaveRoastResult {
    savedSession: RoastSession;
    shouldOpenContinue: boolean;
    /** Session saved but plan_batch status=done update failed — user should complete it in Schedule. */
    batchStatusUpdateFailed?: boolean;
    syncPending?: boolean;
}
