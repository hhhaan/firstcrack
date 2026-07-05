import { zodResolver } from '@hookform/resolvers/zod';
import { computePhaseSegments } from '@features/active-roast/lib/phases';
import { PhaseBar } from '@shared/ui/PhaseBar';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Spinner } from '@shared/ui/Spinner';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { RoastSummaryData } from '../model/useRoastCompletionFlow';

export type { RoastSummaryData };

const roastSummarySchema = z.object({
    notes: z.string().max(2000, 'Notes are too long'),
    weightGrams: z.number().min(0, 'Weight must be 0 or greater'),
    roastLevel: z.string().nullable(),
});

export type RoastSummaryForm = z.infer<typeof roastSummarySchema>;

interface RoastSummaryModalProps {
    open: boolean;
    summaryData: RoastSummaryData | null;
    eventMarkerColor: Record<string, string>;
    onClose: () => void;
    onDiscard: () => void;
    onSave: (data: { notes: string; weightGrams: number; roastLevel: string | null }) => Promise<void>;
    isSaving?: boolean;
    ambientTemp?: number | null;
    ambientHumidity?: number | null;
}

const ROAST_LEVELS = [
    { value: 'Light', label: 'Light' },
    { value: 'Medium-Light', label: 'Medium-Light' },
    { value: 'Medium', label: 'Medium' },
    { value: 'Medium-Dark', label: 'Medium-Dark' },
    { value: 'Dark', label: 'Dark' },
] as const;

export const RoastSummaryModal = ({
    open,
    summaryData,
    eventMarkerColor,
    onClose,
    onDiscard,
    onSave,
    isSaving = false,
    ambientTemp,
    ambientHumidity,
}: RoastSummaryModalProps) => {
    const {
        register,
        handleSubmit,
        watch,
        setValue,
        reset,
        formState: { errors },
    } = useForm<RoastSummaryForm>({
        resolver: zodResolver(roastSummarySchema),
        defaultValues: {
            notes: '',
            weightGrams: 0,
            roastLevel: null,
        },
    });

    const roastLevel = watch('roastLevel');

    // Reset form when modal opens with new summaryData
    useEffect(() => {
        if (open && summaryData) {
            reset({ notes: '', weightGrams: 0, roastLevel: null });
        }
    }, [open, summaryData, reset]);

    if (!open || !summaryData) {
        return null;
    }

    const phaseSegments = computePhaseSegments(summaryData.logEntries, summaryData.elapsedSec, true);

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="roast-summary-modal-title"
            overlayClassName="z-[10000]"
            contentClassName="max-w-[420px] w-full bg-main-bg rounded p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px]"
        >
            <div className="w-11 h-11 rounded-md bg-[rgba(220,252,231,0.9)] dark:bg-[rgba(22,163,74,0.15)] text-[#16a34a] dark:text-[#4be08c] flex items-center justify-center mb-4.5">
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            </div>

            <h2
                id="roast-summary-modal-title"
                className="text-[28px] font-normal leading-[1.05] text-primary tracking-[-0.5px] mb-6"
            >
                Roast Complete
            </h2>

            <div className="grid grid-cols-3 gap-2 mb-5">
                {[
                    { label: 'Total Time', value: summaryData.totalTime },
                    { label: 'Development', value: summaryData.development },
                    { label: 'Final BT', value: summaryData.finalBt },
                ].map(({ label, value }) => (
                    <div key={label} className="bg-surface dark:bg-[#262B31] rounded px-2.5 py-2.5 ">
                        <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">{label}</div>
                        <div className="font-(--font-mono) text-sm text-primary">{value}</div>
                    </div>
                ))}
            </div>

            {ambientTemp != null && ambientHumidity != null && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-surface dark:bg-[#262B31] rounded px-2.5 py-2.5 ">
                        <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">Temperature</div>
                        <div className="font-(--font-mono) text-sm text-primary">{ambientTemp}°C</div>
                    </div>
                    <div className="bg-surface dark:bg-[#262B31] rounded px-2.5 py-2.5 ">
                        <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">Humidity</div>
                        <div className="font-(--font-mono) text-sm text-primary">{ambientHumidity}%</div>
                    </div>
                </div>
            )}

            {phaseSegments.length > 0 && (
                <div className="mb-5">
                    <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.4px] mb-2.5">Phase</div>
                    <PhaseBar segments={phaseSegments} />
                </div>
            )}

            <div className="mb-5">
                <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.4px] mb-2.5">Log</div>
                <div className="flex flex-wrap gap-y-1.5">
                    {summaryData.logEntries
                        .filter(
                            (entry) =>
                                eventMarkerColor[entry.event] ||
                                entry.event === 'Charge' ||
                                entry.event === 'Turning Point',
                        )
                        .map((entry, index, entries) => (
                            <div key={`${entry.time}-${entry.event}-${index}`} className="flex items-center gap-1">
                                <span className="text-xs font-(--font-mono) text-muted">{entry.time}</span>
                                <span
                                    className="text-xs font-medium"
                                    style={{ color: eventMarkerColor[entry.event] ?? 'var(--color-secondary)' }}
                                >
                                    {entry.event}
                                </span>
                                {index < entries.length - 1 && <span className="mx-1.5 text-border text-sm">·</span>}
                            </div>
                        ))}
                </div>
            </div>

            <div className="mb-5">
                <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.4px] mb-2">Batch Weight</div>
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        min={0}
                        step={0.1}
                        {...register('weightGrams', { valueAsNumber: true })}
                        placeholder="0.0"
                        className="w-full px-3.5 py-2.5 rounded border-none dark:border dark:border-border bg-surface dark:bg-[#262B31] text-primary text-[13px] font-(--font-mono) outline-none box-border"
                    />
                    <span className="text-[11px] text-muted font-semibold tracking-[0.3px]">kg</span>
                </div>
                {errors.weightGrams && <p className="text-[11px] text-red-500 mt-1">{errors.weightGrams.message}</p>}
            </div>

            <div className="mb-5">
                <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.4px] mb-2">Roast Level</div>
                <div className="flex flex-wrap gap-1.5">
                    {ROAST_LEVELS.map(({ value, label }) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setValue('roastLevel', roastLevel === value ? null : value)}
                            className={`px-3 py-1.5 rounded-md text-[12px] font-medium tracking-[0.2px] border-none cursor-pointer transition-colors ${
                                roastLevel === value
                                    ? 'bg-primary text-white'
                                    : 'bg-surface dark:bg-[#262B31] text-secondary hover:text-primary'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mb-6">
                <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.4px] mb-2">Notes</div>
                <textarea
                    {...register('notes')}
                    placeholder="Flavor notes, observations, adjustments for next time..."
                    rows={2}
                    className="w-full px-3.5 py-2.5 rounded border-none dark:border dark:border-border bg-surface dark:bg-[#262B31] text-primary text-[13px] font-(--font-body) resize-none outline-none box-border"
                />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                    onClick={handleSubmit((data: RoastSummaryForm) => onSave(data))}
                    disabled={isSaving}
                    className="w-full py-3 rounded-lg border-none bg-[rgba(220,252,231,0.9)] dark:bg-[rgba(22,163,74,0.15)] text-[#16a34a] dark:text-[#4be08c] text-sm font-medium tracking-[0.14px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {isSaving && <Spinner />}
                    저장
                </button>
                <button
                    onClick={onDiscard}
                    className="w-full py-3 rounded-lg bg-surface dark:bg-[#262B31] text-secondary text-sm font-medium cursor-pointer tracking-[0.14px] dark:border dark:border-border"
                >
                    저장 안 함
                </button>
            </div>
        </ModalShell>
    );
};
