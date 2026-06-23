import type { RoastSessionInsert } from '@entities/roast';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import type { MutableRefObject } from 'react';

export interface BuildSavePayloadParams {
    userId: string;
    elapsed: number;
    roastStartTimeRef: MutableRefObject<number>;
    saveWeight: number;
    saveLevel: string | null;
    notes: string;
    rawBT: number | null;
    ambientTemperature?: number | null;
    ambientHumidity?: number | null;
    selectedBeanId: string | null;
    targetProfileId: string | null;
    planBatchHandoff: PlanBatchHandoff | null;
}

export const buildRoastSavePayload = (params: BuildSavePayloadParams, tsvPath: string | null): RoastSessionInsert => {
    const {
        userId,
        elapsed,
        roastStartTimeRef,
        saveWeight,
        saveLevel,
        notes,
        rawBT,
        ambientTemperature,
        ambientHumidity,
        selectedBeanId,
        targetProfileId,
        planBatchHandoff,
    } = params;

    const roastedAt = roastStartTimeRef.current > 0 ? new Date(roastStartTimeRef.current).toISOString() : null;

    return {
        user_id: userId,
        weight_grams: saveWeight,
        status: 'completed',
        roasted_at: roastedAt,
        duration_seconds: elapsed,
        drop_temp_celsius: rawBT != null ? Math.round(rawBT) : null,
        roast_level: saveLevel,
        scheduled_at: null,
        notes: notes || null,
        ambient_temp_celsius: ambientTemperature ?? null,
        ambient_humidity_pct: ambientHumidity ?? null,
        bean_id: selectedBeanId,
        profile_id: targetProfileId,
        tsv_path: tsvPath,
        plan_batch_id: planBatchHandoff?.planBatchId ?? null,
    };
};
