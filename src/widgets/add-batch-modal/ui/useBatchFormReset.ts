import type { Machine } from '@entities/machine';
import { parseRruleToInterval, type RecurrenceInterval } from '@shared/lib/rrule';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { useEffect } from 'react';
import { type BatchType, DEFAULT_BATCH_SIZE, DEFAULT_YIELD } from '../lib/types';

const todayDate = () => new Date();

type Params = {
    open: boolean;
    editingBatch: PlanBatchWithProgress | null;
    currentDateKey?: string;
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
            setDate(
                currentDateKey
                    ? new Date(`${currentDateKey}T00:00:00`)
                    : editingBatch.scheduled_date
                      ? new Date(`${editingBatch.scheduled_date}T00:00:00`)
                      : todayDate(),
            );
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
            setDate(todayDate());
            setRecurringInterval(null);
            setMachineId(machines[0]?.id ?? '');
            setBatchType('Single Origin');
            setProfileId('');
            setBeanId('');
            setBlendId(null);
            setTargetRoasted('');
            setBatchSize(String(DEFAULT_BATCH_SIZE));
            setYieldPct(String(DEFAULT_YIELD));
            setNotes('');
        }
    }, [
        open,
        editingBatch,
        currentDateKey,
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
