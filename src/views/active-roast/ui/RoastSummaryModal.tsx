import { useBeans } from '@entities/bean/queries';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuthStore } from '@shared/store/auth';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Spinner } from '@shared/ui/Spinner';
import { Check, Coffee } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { RoastSummaryData } from '../model/useRoastCompletionFlow';

export type { RoastSummaryData };

const baseRoastSummarySchema = z.object({
    notes: z.string().max(2000, 'Notes are too long'),
    weightGrams: z.number().min(0, 'Weight must be 0 or greater'),
    roastLevel: z.string().nullable(),
    beanId: z.string().nullable(),
});

export type RoastSummaryForm = z.infer<typeof baseRoastSummarySchema>;

interface RoastSummaryModalProps {
    open: boolean;
    summaryData: RoastSummaryData | null;
    eventMarkerColor: Record<string, string>;
    onClose: () => void;
    onDiscard: () => void;
    onSave: (data: RoastSummaryForm) => Promise<void>;
    isSaving?: boolean;
    ambientTemp?: number | null;
    ambientHumidity?: number | null;
    /** Pre-selected bean from roast header / handoff */
    selectedBeanId?: string | null;
    /** Blend handoff already covers stock — no single-bean picker */
    hasBlendHandoff?: boolean;
    /** Schedule/inventory display name when beans list not resolved yet */
    fallbackBeanName?: string | null;
}

const ROAST_LEVEL_VALUES = [
    { value: 'Light', key: 'light' },
    { value: 'Medium-Light', key: 'mediumLight' },
    { value: 'Medium', key: 'medium' },
    { value: 'Medium-Dark', key: 'mediumDark' },
    { value: 'Dark', key: 'dark' },
] as const;

const beanMeta = (b: { origin: string | null; region: string | null; farm: string | null; variety: string | null }) =>
    [b.origin, b.region, b.farm, b.variety].filter(Boolean).join(' · ');

const beanOptionLabel = (b: {
    name: string;
    origin: string | null;
    region: string | null;
    farm: string | null;
    variety: string | null;
}) => {
    const meta = beanMeta(b);
    return meta ? `${b.name} (${meta})` : b.name;
};

const sectionLabelClass = 'text-[11px] font-semibold text-muted uppercase tracking-[0.4px] mb-2';

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
    selectedBeanId = null,
    hasBlendHandoff = false,
    fallbackBeanName = null,
}: RoastSummaryModalProps) => {
    const { t } = useTranslation();
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: beans = [] } = useBeans(userId);
    const needsBeanPicker = !selectedBeanId && !hasBlendHandoff;
    const showBeanSection = needsBeanPicker || Boolean(selectedBeanId || hasBlendHandoff || fallbackBeanName);

    // Single bean required for save (stock deduct needs bean_id). Blend handoff is the exception.
    const roastSummarySchema = useMemo(
        () =>
            baseRoastSummarySchema.superRefine((data, ctx) => {
                if (hasBlendHandoff) return;
                if (!data.beanId) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['beanId'],
                        message: t('activeRoast.summary.beanRequired'),
                    });
                }
            }),
        [hasBlendHandoff, t],
    );

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
            beanId: selectedBeanId,
        },
    });

    const roastLevel = watch('roastLevel');
    const formBeanId = watch('beanId');

    const selectedBeanIdRef = useRef(selectedBeanId);
    selectedBeanIdRef.current = selectedBeanId;

    useEffect(() => {
        if (open && summaryData) {
            reset({
                notes: '',
                weightGrams: 0,
                roastLevel: null,
                beanId: selectedBeanIdRef.current,
            });
        }
    }, [open, summaryData, reset]);

    useEffect(() => {
        if (open && summaryData) {
            setValue('beanId', selectedBeanId, { shouldDirty: false });
        }
    }, [selectedBeanId, open, summaryData, setValue]);

    const resolvedBeanId = selectedBeanId ?? formBeanId;
    const displayBean = useMemo(
        () => (resolvedBeanId ? beans.find((b) => b.id === resolvedBeanId) : undefined),
        [beans, resolvedBeanId],
    );
    const displayName = displayBean?.name ?? fallbackBeanName ?? null;
    const displayMeta = displayBean ? beanMeta(displayBean) : '';

    if (!open || !summaryData) {
        return null;
    }

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="roast-summary-modal-title"
            overlayClassName="z-[10000]"
            contentClassName="max-w-[420px] w-full bg-main-bg rounded p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px]"
        >
            <div className="w-11 h-11 rounded-md bg-[rgba(220,252,231,0.9)] dark:bg-[rgba(22,163,74,0.15)] text-[#16a34a] dark:text-[#4be08c] flex items-center justify-center mb-4.5">
                <Check size={18} strokeWidth={2.5} />
            </div>

            <h2
                id="roast-summary-modal-title"
                className="text-[28px] font-normal leading-[1.05] text-primary tracking-[-0.5px] mb-6"
            >
                {t('activeRoast.summary.title')}
            </h2>

            <div className="grid grid-cols-3 gap-2 mb-5">
                {[
                    { label: t('activeRoast.summary.totalTime'), value: summaryData.totalTime },
                    { label: t('activeRoast.summary.development'), value: summaryData.development },
                    { label: t('activeRoast.summary.finalBt'), value: summaryData.finalBt },
                ].map(({ label, value }) => (
                    <div key={label} className="bg-surface dark:bg-[#262B31] rounded px-2.5 py-2.5">
                        <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">{label}</div>
                        <div className="font-(--font-mono) text-sm text-primary">{value}</div>
                    </div>
                ))}
            </div>

            {ambientTemp != null && ambientHumidity != null && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-surface dark:bg-[#262B31] rounded px-2.5 py-2.5">
                        <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">
                            {t('activeRoast.summary.temperature')}
                        </div>
                        <div className="font-(--font-mono) text-sm text-primary">{ambientTemp}°C</div>
                    </div>
                    <div className="bg-surface dark:bg-[#262B31] rounded px-2.5 py-2.5">
                        <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">
                            {t('activeRoast.summary.humidity')}
                        </div>
                        <div className="font-(--font-mono) text-sm text-primary">{ambientHumidity}%</div>
                    </div>
                </div>
            )}

            <div className="mb-5">
                <div className={sectionLabelClass}>{t('activeRoast.summary.log')}</div>
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

            {showBeanSection && (
                <div className="mb-5">
                    <div className={sectionLabelClass}>{t('activeRoast.summary.bean')}</div>

                    {needsBeanPicker ? (
                        <>
                            <p className="text-[12px] text-muted leading-snug mb-2">
                                {t('activeRoast.summary.beanHint')}
                            </p>
                            <div
                                className={`rounded-lg bg-surface dark:bg-[#262B31] px-3 py-0.5 ${
                                    errors.beanId ? 'ring-1 ring-red-400/80' : ''
                                }`}
                            >
                                <select
                                    value={formBeanId ?? ''}
                                    onChange={(e) =>
                                        setValue('beanId', e.target.value || null, {
                                            shouldDirty: true,
                                            shouldValidate: true,
                                        })
                                    }
                                    className="w-full py-2.5 bg-transparent border-none outline-none text-primary text-[13px] cursor-pointer appearance-none"
                                >
                                    <option value="">{t('activeRoast.summary.beanPlaceholder')}</option>
                                    {beans.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {beanOptionLabel(b)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {errors.beanId && (
                                <p className="text-[11px] text-red-500 mt-1.5">{errors.beanId.message}</p>
                            )}
                        </>
                    ) : (
                        <div className="rounded-lg bg-surface dark:bg-[#262B31] px-3.5 py-3 flex items-start gap-3">
                            <div className="w-8 h-8 rounded-md bg-palette-green/12 text-palette-green flex items-center justify-center shrink-0 mt-0.5">
                                <Coffee size={15} strokeWidth={2.2} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[14px] font-medium text-primary tracking-[0.14px] truncate">
                                    {displayName ?? t('activeRoast.header.noBeanSelected')}
                                </p>
                                {displayMeta ? (
                                    <p className="text-[12px] text-muted mt-0.5 truncate">{displayMeta}</p>
                                ) : (
                                    <p className="text-[12px] text-muted mt-0.5">
                                        {t('activeRoast.summary.beanSelected')}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="mb-5">
                <div className={sectionLabelClass}>{t('activeRoast.summary.batchWeight')}</div>
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
                <div className={sectionLabelClass}>{t('activeRoast.summary.roastLevel')}</div>
                <div className="flex flex-wrap gap-1.5">
                    {ROAST_LEVEL_VALUES.map(({ value, key }) => (
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
                            {t(`activeRoast.summary.levels.${key}`)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mb-6">
                <div className={sectionLabelClass}>{t('activeRoast.summary.notes')}</div>
                <textarea
                    {...register('notes')}
                    placeholder={t('activeRoast.summary.notesPlaceholder')}
                    rows={2}
                    className="w-full px-3.5 py-2.5 rounded border-none dark:border dark:border-border bg-surface dark:bg-[#262B31] text-primary text-[13px] font-(--font-body) resize-none outline-none box-border"
                />
            </div>

            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    onClick={handleSubmit((data: RoastSummaryForm) => onSave(data))}
                    disabled={isSaving}
                    className="w-full py-3 rounded-lg border-none bg-[rgba(220,252,231,0.9)] dark:bg-[rgba(22,163,74,0.15)] text-[#16a34a] dark:text-[#4be08c] text-sm font-medium tracking-[0.14px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {isSaving && <Spinner />}
                    {t('activeRoast.summary.save')}
                </button>
                <button
                    type="button"
                    onClick={onDiscard}
                    className="w-full py-3 rounded-lg bg-surface dark:bg-[#262B31] text-secondary text-sm font-medium cursor-pointer tracking-[0.14px] dark:border dark:border-border"
                >
                    {t('activeRoast.summary.discard')}
                </button>
            </div>
        </ModalShell>
    );
};
