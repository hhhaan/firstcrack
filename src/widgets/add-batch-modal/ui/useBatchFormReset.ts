import type { Machine } from '@entities/machine';
import { parseRruleToInterval, type RecurrenceInterval } from '@shared/lib/rrule';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { useEffect } from 'react';
import { type BatchPrefill, type BatchType, DEFAULT_BATCH_SIZE, DEFAULT_YIELD } from '../lib/types';

const todayDate = () => new Date();

export const resolveInitialBatchDate = (editingBatch: PlanBatchWithProgress | null, currentDateKey?: string): Date => {
    if (editingBatch?.scheduled_date) {
        return new Date(`${editingBatch.scheduled_date}T00:00:00`);
    }
    if (currentDateKey) {
        return new Date(`${currentDateKey}T00:00:00`);
    }
    return todayDate();
};

type Params = {
    open: boolean;
    editingBatch: PlanBatchWithProgress | null;
    currentDateKey?: string;
    initialPrefill?: BatchPrefill | null;
    machines: Machine[];
    setDate: (d: Date | undefined) => void;
    setRecurringInterval: (v: RecurrenceInterval | null) => void;
    setMachineId: (v: string) => void;
    setBatchType: (v: BatchType) => void;
    setProfileId: (v: string) => void;
    setBeanId: (v: string) => void;
    setBlendId: (v: string | null) => void;
    setTargetRoasted: (v: string) => void;
    setBatchSize: (v: string) => void;
    setYieldPct: (v: string) => void;
    setNotes: (v: string) => void;
};

export const useBatchFormReset = ({
    open,
    editingBatch,
    currentDateKey,
    initialPrefill,
    machines,
    setDate,
    setRecurringInterval,
    setMachineId,
    setBatchType,
    setProfileId,
    setBeanId,
    setBlendId,
    setTargetRoasted,
    setBatchSize,
    setYieldPct,
    setNotes,
}: Params) => {
    useEffect(() => {
        if (!open) return;

        if (editingBatch) {
            setDate(resolveInitialBatchDate(editingBatch, currentDateKey));
            setRecurringInterval(editingBatch.rrule ? parseRruleToInterval(editingBatch.rrule) : null);
            setMachineId(editingBatch.machine_id ?? machines[0]?.id ?? '');
            setBatchType((editingBatch.batch_type as BatchType) || 'Single Origin');
            setProfileId(editingBatch.roast_profile_id ?? '');
            setBeanId(editingBatch.bean_id ?? '');
            setBlendId(editingBatch.blend_id ?? null);
            setTargetRoasted(String(editingBatch.target_roasted_kg));
            setBatchSize(String(editingBatch.batch_size_kg));
            setYieldPct(String(Math.round((editingBatch.yield_pct ?? 0.82) * 100)));
            setNotes(editingBatch.notes ?? '');
        } else {
            setDate(resolveInitialBatchDate(null, currentDateKey));
            setRecurringInterval(null);
            setMachineId(machines[0]?.id ?? '');
            setBatchType('Single Origin');
            setProfileId(initialPrefill?.profileId ?? '');
            setBeanId(initialPrefill?.beanId ?? '');
            setBlendId(null);
            const greenKg = initialPrefill?.greenKg;
            if (greenKg != null && greenKg > 0) {
                const green = Math.round(greenKg * 10) / 10;
                setBatchSize(String(green));
                setTargetRoasted(String(Math.round(green * DEFAULT_YIELD) / 100));
            } else {
                setTargetRoasted('');
                setBatchSize(String(DEFAULT_BATCH_SIZE));
            }
            setYieldPct(String(DEFAULT_YIELD));
            setNotes('');
        }
    }, [
        open,
        editingBatch,
        currentDateKey,
        initialPrefill,
        machines,
        setDate,
        setRecurringInterval,
        setMachineId,
        setBatchType,
        setProfileId,
        setBeanId,
        setBlendId,
        setTargetRoasted,
        setBatchSize,
        setYieldPct,
        setNotes,
    ]);
};
