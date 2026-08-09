import { useBeans } from '@entities/bean/queries';
import { useActiveWorkspace } from '@entities/organization';
import { useDayBatches } from '@entities/plan';
import { summaryPrefill } from '@features/active-roast/lib/summaryPrefill';
import { toPlanBatchHandoff } from '@features/active-roast/lib/toPlanBatchHandoff';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { BeanCombobox } from '@shared/ui/BeanCombobox';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Spinner } from '@shared/ui/Spinner';
import { format } from 'date-fns';
import { Check, Coffee } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { RoastSummaryData } from '../model/useRoastCompletionFlow';

export type { RoastSummaryData };

const baseRoastSummarySchema = z.object({
    notes: z.string().max(2000, 'Notes are too long'),
    weightGrams: z.number().min(0, 'Weight must be 0 or greater'),
    /** Measured roasted output. Blank input yields NaN — treated as "not weighed", not invalid. */
    outputWeightKg: z.union([z.number().min(0, 'Weight must be 0 or greater'), z.nan()]).optional(),
    roastLevel: z.string().nullable(),
    beanId: z.string().nullable(),
    /** Free-text when no inventory bean selected (sample / no-stock). */
    beanLabel: z.string().max(120),
    /** ad-hoc only: link to today's schedule batch, or none */
    linkMode: z.enum(['schedule', 'none']),
    planBatchId: z.string().nullable(),
    deductStock: z.boolean(),
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
    /** Existing schedule handoff — link UI is read-only */
    planBatchHandoff?: PlanBatchHandoff | null;
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

const batchOptionLabel = (b: PlanBatchWithProgress) =>
    `${b.bean_name} · ${b.batch_size_kg}kg · ${b.completed_sessions}/${b.batch_count}`;

const sectionLabelClass = 'text-[11px] font-semibold text-muted uppercase tracking-[0.4px] mb-1.5';

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
    planBatchHandoff = null,
    fallbackBeanName = null,
}: RoastSummaryModalProps) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId, isWorkspaceReady } = useActiveWorkspace();
    const { data: beans = [] } = useBeans(userId);
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data: dayBatches = [] } = useDayBatches(isWorkspaceReady ? userId : '', today);

    const hasHandoff = Boolean(planBatchHandoff);
    const hasBlendHandoff = Boolean(planBatchHandoff?.blendId);

    const incompleteBatches = useMemo(
        () => dayBatches.filter((b) => b.completed_sessions < b.batch_count),
        [dayBatches],
    );

    const roastSummarySchema = useMemo(
        () =>
            baseRoastSummarySchema.superRefine((data, ctx) => {
                if (hasHandoff) return;
                if (data.linkMode === 'schedule') {
                    if (!data.planBatchId) {
                        ctx.addIssue({
                            code: 'custom',
                            path: ['planBatchId'],
                            message: t('activeRoast.summary.planBatchRequired'),
                        });
                    }
                    return;
                }
                // Weight set → inventory bean or free-text label (history needs a name).
                if (data.weightGrams <= 0) return;
                if (data.beanId) return;
                if (!data.beanLabel.trim()) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['beanLabel'],
                        message: t('activeRoast.summary.beanRequired'),
                    });
                }
            }),
        [hasHandoff, t],
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
            outputWeightKg: undefined,
            roastLevel: null,
            beanId: selectedBeanId,
            beanLabel: '',
            linkMode: hasHandoff ? 'schedule' : 'none',
            planBatchId: planBatchHandoff?.planBatchId ?? null,
            deductStock: false,
        },
    });

    const roastLevel = watch('roastLevel');
    const formBeanId = watch('beanId');
    const beanLabel = watch('beanLabel');
    const linkMode = watch('linkMode');
    const formPlanBatchId = watch('planBatchId');
    const deductStock = watch('deductStock');
    const weightGrams = watch('weightGrams');
    const outputWeightKg = watch('outputWeightKg');

    /** Remount combobox when the modal opens so query syncs with prefill. */
    const [beanComboboxKey, setBeanComboboxKey] = useState(0);

    /** null until both green and measured output are present — then the real loss %. */
    const lossPreview = useMemo(() => {
        if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null;
        if (
            outputWeightKg === null ||
            outputWeightKg === undefined ||
            !Number.isFinite(outputWeightKg) ||
            outputWeightKg <= 0
        )
            return null;
        return ((weightGrams - outputWeightKg) / weightGrams) * 100;
    }, [weightGrams, outputWeightKg]);

    const selectedBeanIdRef = useRef(selectedBeanId);
    const handoffRef = useRef(planBatchHandoff);
    const lastAdhoc = useRoastSessionStore((s) => s.lastAdhocSave);
    const lastAdhocRef = useRef(lastAdhoc);
    useEffect(() => {
        selectedBeanIdRef.current = selectedBeanId;
    }, [selectedBeanId]);
    useEffect(() => {
        handoffRef.current = planBatchHandoff;
    }, [planBatchHandoff]);
    useEffect(() => {
        lastAdhocRef.current = lastAdhoc;
    }, [lastAdhoc]);

    useEffect(() => {
        if (open && summaryData) {
            const handoff = handoffRef.current;
            const prefill = summaryPrefill(handoff, lastAdhocRef.current, selectedBeanIdRef.current);
            reset({
                notes: '',
                weightGrams: prefill.weightGrams,
                outputWeightKg: undefined,
                roastLevel: prefill.roastLevel,
                beanId: prefill.beanId,
                beanLabel: '',
                linkMode: handoff ? 'schedule' : 'none',
                planBatchId: handoff?.planBatchId ?? null,
                deductStock: false,
            });
            setBeanComboboxKey((k) => k + 1);
        }
    }, [open, summaryData, reset]);

    useEffect(() => {
        if (open && summaryData && !planBatchHandoff && selectedBeanId) {
            setValue('beanId', selectedBeanId, { shouldDirty: false });
            setValue('beanLabel', '', { shouldDirty: false });
            setBeanComboboxKey((k) => k + 1);
        }
    }, [selectedBeanId, open, summaryData, setValue, planBatchHandoff]);

    const linkedBatch = useMemo(() => {
        if (hasHandoff || linkMode !== 'schedule' || !formPlanBatchId) return null;
        return incompleteBatches.find((b) => b.id === formPlanBatchId) ?? null;
    }, [hasHandoff, linkMode, formPlanBatchId, incompleteBatches]);

    const linkedHandoff = linkedBatch ? toPlanBatchHandoff(linkedBatch) : null;
    const effectiveHandoff = planBatchHandoff ?? linkedHandoff;

    // Schedule batch select → prefill weight/bean. Primitives only so re-renders don't clobber edits.
    const linkedBatchId = linkedBatch?.id ?? null;
    const linkedBatchSizeKg = linkedBatch?.batch_size_kg ?? null;
    const linkedBeanId = linkedBatch?.bean_id ?? null;
    useEffect(() => {
        if (!open || !summaryData || hasHandoff) return;
        if (linkMode !== 'schedule' || !linkedBatchId) return;
        if (linkedBatchSizeKg != null && linkedBatchSizeKg > 0) {
            setValue('weightGrams', linkedBatchSizeKg, { shouldDirty: true, shouldValidate: true });
        }
        if (linkedBeanId) {
            setValue('beanId', linkedBeanId, { shouldDirty: true, shouldValidate: true });
            setValue('beanLabel', '', { shouldDirty: true });
            setBeanComboboxKey((k) => k + 1);
        }
    }, [open, summaryData, hasHandoff, linkMode, linkedBatchId, linkedBatchSizeKg, linkedBeanId, setValue]);

    const showBeanPicker = !hasHandoff && linkMode === 'none';
    const showBeanReadonly = hasHandoff || (linkMode === 'schedule' && Boolean(effectiveHandoff));

    const resolvedBeanId = effectiveHandoff?.beanId ?? formBeanId ?? null;
    const displayBean = useMemo(
        () => (resolvedBeanId ? beans.find((b) => b.id === resolvedBeanId) : undefined),
        [beans, resolvedBeanId],
    );
    const displayName = effectiveHandoff?.beanName ?? displayBean?.name ?? fallbackBeanName ?? null;
    const displayMeta = displayBean && !effectiveHandoff?.blendId ? beanMeta(displayBean) : '';

    const deductionKg = useMemo(() => {
        if (Number.isFinite(weightGrams) && weightGrams > 0) return weightGrams;
        return effectiveHandoff?.batchSizeKg ?? 0;
    }, [effectiveHandoff, weightGrams]);

    const isCustomBean = showBeanPicker && !formBeanId && Boolean(beanLabel.trim());
    const canDeduct =
        !isCustomBean && deductionKg > 0 && Boolean(resolvedBeanId || effectiveHandoff?.blendId || hasBlendHandoff);

    const beanComboboxItems = useMemo(() => beans.map((b) => ({ id: b.id, name: b.name })), [beans]);

    if (!open || !summaryData) {
        return null;
    }

    const ambientLine = [
        ambientTemp != null ? `${t('activeRoast.summary.temperature')} ${ambientTemp}°C` : null,
        ambientHumidity != null ? `${t('activeRoast.summary.humidity')} ${ambientHumidity}%` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <ModalShell
            onClose={onClose}
            dismissable={false}
            labelledBy="roast-summary-modal-title"
            overlayClassName="z-[10000]"
            contentClassName={`${modalPanel.sm} max-h-[min(720px,calc(100vh-64px))] !p-0 flex flex-col overflow-hidden`}
        >
            <ModalScrollBody contentClassName="px-7 pt-7 pb-4">
                <div className="w-9 h-9 rounded-md bg-[rgba(220,252,231,0.9)] dark:bg-[rgba(22,163,74,0.15)] text-[#16a34a] dark:text-[#4be08c] flex items-center justify-center mb-3">
                    <Check size={16} strokeWidth={2.5} />
                </div>

                <h2
                    id="roast-summary-modal-title"
                    className="text-[22px] font-normal leading-[1.1] text-primary tracking-[-0.4px] mb-3.5"
                >
                    {t('activeRoast.summary.title')}
                </h2>

                <div className={`grid grid-cols-3 gap-1.5 ${ambientLine ? 'mb-1' : 'mb-3.5'}`}>
                    {[
                        { label: t('activeRoast.summary.totalTime'), value: summaryData.totalTime },
                        { label: t('activeRoast.summary.development'), value: summaryData.development },
                        { label: t('activeRoast.summary.finalBt'), value: summaryData.finalBt },
                    ].map(({ label, value }) => (
                        <div key={label} className="bg-surface dark:bg-[#262B31] rounded px-2 py-2">
                            <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">{label}</div>
                            <div className="font-(--font-mono) text-[13px] text-primary">{value}</div>
                        </div>
                    ))}
                </div>

                {ambientLine ? (
                    <p className="text-[11px] text-muted font-(--font-mono) tracking-[0.14px] mb-3.5">{ambientLine}</p>
                ) : null}

                <div className="mb-3.5">
                    <div className={sectionLabelClass}>{t('activeRoast.summary.log')}</div>
                    <div className="flex flex-wrap gap-y-1">
                        {summaryData.logEntries
                            .filter(
                                (entry) =>
                                    eventMarkerColor[entry.event] ||
                                    entry.event === 'Charge' ||
                                    entry.event === 'Turning Point',
                            )
                            .map((entry, index, entries) => (
                                <div key={`${entry.time}-${entry.event}-${index}`} className="flex items-center gap-1">
                                    <span className="text-[11px] font-(--font-mono) text-muted">{entry.time}</span>
                                    <span
                                        className="text-[11px] font-medium"
                                        style={{
                                            color: eventMarkerColor[entry.event] ?? 'var(--color-secondary)',
                                        }}
                                    >
                                        {entry.event}
                                    </span>
                                    {index < entries.length - 1 && <span className="mx-1 text-border text-xs">·</span>}
                                </div>
                            ))}
                    </div>
                </div>

                {/* ── Link: schedule batch or ad-hoc ── */}
                <div className="mb-3.5">
                    <div className={sectionLabelClass}>{t('activeRoast.summary.link')}</div>

                    {hasHandoff && planBatchHandoff ? (
                        <div className="rounded-lg bg-surface dark:bg-[#262B31] px-3 py-2.5">
                            <p className="text-[13px] font-medium text-primary tracking-[0.14px] truncate">
                                {planBatchHandoff.beanName}
                            </p>
                            <p className="text-[11px] text-muted mt-0.5">
                                {t('activeRoast.summary.sessionProgress', {
                                    current: planBatchHandoff.completedSessions + 1,
                                    total: planBatchHandoff.batchCount,
                                })}
                                {' · '}
                                {planBatchHandoff.batchSizeKg}kg
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="flex gap-2 mb-2">
                                {(
                                    [
                                        { value: 'schedule' as const, label: t('activeRoast.summary.linkSchedule') },
                                        { value: 'none' as const, label: t('activeRoast.summary.linkNone') },
                                    ] as const
                                ).map(({ value, label }) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => {
                                            setValue('linkMode', value, { shouldValidate: true });
                                            if (value === 'none') {
                                                setValue('planBatchId', null, { shouldValidate: true });
                                            }
                                        }}
                                        className={`flex-1 px-3 py-1.5 rounded-md text-[12px] font-medium tracking-[0.2px] border-none cursor-pointer transition-colors ${
                                            linkMode === value
                                                ? 'bg-primary text-white'
                                                : 'bg-surface dark:bg-[#262B31] text-secondary hover:text-primary'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {linkMode === 'schedule' && (
                                <>
                                    <div
                                        className={`rounded-lg bg-surface dark:bg-[#262B31] px-3 py-0.5 ${
                                            errors.planBatchId ? 'ring-1 ring-red-400/80' : ''
                                        }`}
                                    >
                                        <select
                                            value={formPlanBatchId ?? ''}
                                            onChange={(e) =>
                                                setValue('planBatchId', e.target.value || null, {
                                                    shouldDirty: true,
                                                    shouldValidate: true,
                                                })
                                            }
                                            disabled={!isWorkspaceReady || incompleteBatches.length === 0}
                                            className="w-full py-2 bg-transparent border-none outline-none text-primary text-[13px] cursor-pointer appearance-none disabled:opacity-50"
                                        >
                                            <option value="">
                                                {incompleteBatches.length === 0
                                                    ? t('activeRoast.summary.noOpenBatches')
                                                    : t('activeRoast.summary.planBatchPlaceholder')}
                                            </option>
                                            {incompleteBatches.map((b) => (
                                                <option key={b.id} value={b.id}>
                                                    {batchOptionLabel(b)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    {effectiveHandoff && (
                                        <p className="text-[11px] text-muted mt-1">
                                            {t('activeRoast.summary.sessionProgress', {
                                                current: effectiveHandoff.completedSessions + 1,
                                                total: effectiveHandoff.batchCount,
                                            })}
                                        </p>
                                    )}
                                    {errors.planBatchId && (
                                        <p className="text-[11px] text-red-500 mt-1">{errors.planBatchId.message}</p>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>

                {/* ── Bean ── */}
                {(showBeanPicker || showBeanReadonly) && (
                    <div className="mb-3.5">
                        <div className={sectionLabelClass}>{t('activeRoast.summary.bean')}</div>

                        {showBeanPicker ? (
                            <>
                                <p className="text-[11px] text-muted leading-snug mb-1.5">
                                    {t('activeRoast.summary.beanComboboxHint')}
                                </p>
                                <div
                                    className={
                                        errors.beanLabel || errors.beanId ? 'rounded-lg ring-1 ring-red-400/80' : ''
                                    }
                                >
                                    <BeanCombobox
                                        key={beanComboboxKey}
                                        data-testid="roast-summary-bean"
                                        items={beanComboboxItems}
                                        selectedId={formBeanId ?? ''}
                                        placeholder={t('activeRoast.summary.beanComboboxPlaceholder')}
                                        emptyLabel={t('activeRoast.summary.beanComboboxEmpty')}
                                        listToggleLabel={t('activeRoast.summary.beanComboboxToggle')}
                                        onSelect={(id) => {
                                            setValue('beanId', id || null, {
                                                shouldDirty: true,
                                                shouldValidate: true,
                                            });
                                            if (id) {
                                                setValue('beanLabel', '', {
                                                    shouldDirty: true,
                                                    shouldValidate: true,
                                                });
                                            }
                                        }}
                                        onFreeText={(name) => {
                                            setValue('beanId', null, { shouldDirty: true, shouldValidate: true });
                                            setValue('beanLabel', name, {
                                                shouldDirty: true,
                                                shouldValidate: true,
                                            });
                                            if (name.trim()) setValue('deductStock', false);
                                        }}
                                    />
                                </div>
                                {errors.beanLabel || errors.beanId ? (
                                    <p className="text-[11px] text-red-500 mt-1">
                                        {errors.beanLabel?.message ?? errors.beanId?.message}
                                    </p>
                                ) : isCustomBean ? (
                                    <p className="text-[11px] text-muted mt-1">
                                        {t('activeRoast.summary.beanLabelNoStock')}
                                    </p>
                                ) : null}
                            </>
                        ) : (
                            <div className="rounded-lg bg-surface dark:bg-[#262B31] px-3 py-2.5 flex items-start gap-2.5">
                                <div className="w-7 h-7 rounded-md bg-palette-green/12 text-palette-green flex items-center justify-center shrink-0 mt-0.5">
                                    <Coffee size={14} strokeWidth={2.2} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-medium text-primary tracking-[0.14px] truncate">
                                        {displayName ?? t('activeRoast.header.noBeanSelected')}
                                    </p>
                                    {displayMeta ? (
                                        <p className="text-[11px] text-muted mt-0.5 truncate">{displayMeta}</p>
                                    ) : (
                                        <p className="text-[11px] text-muted mt-0.5">
                                            {t('activeRoast.summary.beanSelected')}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="mb-3.5">
                    <div className={sectionLabelClass}>{t('activeRoast.summary.batchWeight')}</div>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={0}
                            step={0.1}
                            data-testid="roast-summary-weight"
                            {...register('weightGrams', { valueAsNumber: true })}
                            placeholder="0.0"
                            className="w-full px-3 py-2 rounded border-none dark:border dark:border-border bg-surface dark:bg-[#262B31] text-primary text-[13px] font-(--font-mono) outline-none box-border"
                        />
                        <span className="text-[11px] text-muted font-semibold tracking-[0.3px]">kg</span>
                    </div>
                    {errors.weightGrams && (
                        <p className="text-[11px] text-red-500 mt-1">{errors.weightGrams.message}</p>
                    )}
                </div>

                <div className="mb-3.5">
                    <div className={sectionLabelClass}>{t('activeRoast.summary.outputWeight')}</div>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={0}
                            step={0.01}
                            {...register('outputWeightKg', { valueAsNumber: true })}
                            placeholder={t('activeRoast.summary.outputWeightPlaceholder')}
                            className="w-full px-3 py-2 rounded border-none dark:border dark:border-border bg-surface dark:bg-[#262B31] text-primary text-[13px] font-(--font-mono) outline-none box-border"
                        />
                        <span className="text-[11px] text-muted font-semibold tracking-[0.3px]">kg</span>
                    </div>
                    {errors.outputWeightKg ? (
                        <p className="text-[11px] text-red-500 mt-1">{errors.outputWeightKg.message}</p>
                    ) : (
                        <p className="text-[11px] text-muted mt-1">
                            {lossPreview !== null
                                ? t('activeRoast.summary.lossRateMeasured', { pct: lossPreview.toFixed(1) })
                                : t('activeRoast.summary.lossRateEstimated')}
                        </p>
                    )}
                </div>

                <div className="mb-3.5">
                    <div className={sectionLabelClass}>{t('activeRoast.summary.roastLevel')}</div>
                    <div className="flex flex-wrap gap-1">
                        {ROAST_LEVEL_VALUES.map(({ value, key }) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setValue('roastLevel', roastLevel === value ? null : value)}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium tracking-[0.2px] border-none cursor-pointer transition-colors ${
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

                <div className="mb-3.5">
                    <div className={sectionLabelClass}>{t('activeRoast.summary.notes')}</div>
                    <textarea
                        {...register('notes')}
                        placeholder={t('activeRoast.summary.notesPlaceholder')}
                        rows={2}
                        className="w-full px-3 py-2 rounded border-none dark:border dark:border-border bg-surface dark:bg-[#262B31] text-primary text-[13px] font-(--font-body) resize-none outline-none box-border"
                    />
                </div>

                <label
                    className={`flex items-start gap-2.5 ${canDeduct ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                >
                    <input
                        type="checkbox"
                        data-testid="roast-summary-deduct"
                        checked={deductStock && canDeduct}
                        disabled={!canDeduct}
                        onChange={(e) => setValue('deductStock', e.target.checked)}
                        className="mt-0.5 shrink-0"
                    />
                    <span className="text-[12px] text-primary leading-snug">
                        {canDeduct
                            ? t('activeRoast.summary.deductStock', { kg: deductionKg.toFixed(1) })
                            : isCustomBean
                              ? t('activeRoast.summary.deductStockCustomBean')
                              : t('activeRoast.summary.deductStockDisabled')}
                    </span>
                </label>
            </ModalScrollBody>

            <div className="shrink-0 px-7 py-4 border-t border-black/5 dark:border-[#585d61] flex flex-col gap-2 bg-main-bg dark:bg-[#181d21]">
                <button
                    type="button"
                    data-testid="roast-summary-save"
                    onClick={handleSubmit((data: RoastSummaryForm) => onSave(data))}
                    disabled={isSaving}
                    className="w-full py-2.5 rounded-lg border-none bg-[rgba(220,252,231,0.9)] dark:bg-[rgba(22,163,74,0.15)] text-[#16a34a] dark:text-[#4be08c] text-sm font-medium tracking-[0.14px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {isSaving && <Spinner />}
                    {t('activeRoast.summary.save')}
                </button>
                <button
                    type="button"
                    onClick={onDiscard}
                    className="w-full py-2.5 rounded-lg bg-surface dark:bg-[#262B31] text-secondary text-sm font-medium cursor-pointer tracking-[0.14px] dark:border dark:border-border"
                >
                    {t('activeRoast.summary.discard')}
                </button>
            </div>
        </ModalShell>
    );
};
