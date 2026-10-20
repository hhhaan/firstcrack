import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { eventMarkerCssColor, isChartEventMarker } from '@features/active-roast/lib/chart-config';
import { MAX_BATCH_WEIGHT_KG, type RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import { isDeductDisplayEligible } from '@features/active-roast/lib/summaryPrefill';
// import { useBbpStore } from '@features/active-roast/model/bbp';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import { useAuthStore } from '@shared/store/auth';
import { useCatalogVisibility } from '@shared/store/catalog-visibility';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { BeanCombobox } from '@shared/ui/BeanCombobox';
import { formErrorCls } from '@shared/ui/form-styles';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Spinner } from '@shared/ui/Spinner';
import { ask } from '@tauri-apps/plugin-dialog';
import { Check, Coffee, X } from 'lucide-react';
import { useMemo } from 'react';
// import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { RoastSummaryData } from '../model/useRoastCompletionFlow';
import { useRoastSummaryForm } from '../model/useRoastSummaryForm';

// import { RoastSummaryLiveStatus } from './RoastSummaryLiveStatus';

export type { RoastSummaryData };

interface RoastSummaryModalProps {
    open: boolean;
    summaryData: RoastSummaryData | null;
    onClose: () => void;
    onDiscard: () => void;
    onCancelDrop: () => void;
    canCancelDrop: boolean;
    onSave: (data: RoastSummaryForm) => Promise<void>;
    isSaving?: boolean;
    bbpEnabled?: boolean;
    ambientTemp?: number | null;
    ambientHumidity?: number | null;
    /** Pre-selected bean from roast header / handoff */
    selectedBeanId?: string | null;
    selectedBlendId?: string | null;
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
    onClose,
    onDiscard,
    onCancelDrop,
    canCancelDrop,
    onSave,
    isSaving = false,
    bbpEnabled: _bbpEnabled = true,
    ambientTemp,
    ambientHumidity,
    selectedBeanId = null,
    selectedBlendId = null,
    planBatchHandoff = null,
    fallbackBeanName = null,
}: RoastSummaryModalProps) => {
    const { t } = useTranslation();
    // const bbpLive = useBbpStore((s) => s.active && s.recording && s.startMs > 0);
    const hasHandoff = Boolean(planBatchHandoff);
    const {
        form: {
            register,
            handleSubmit,
            watch,
            setValue,
            formState: { errors },
        },
        isWorkspaceReady,
        incompleteBatches,
        beans,
        effectiveHandoff,
        beanFieldEpoch,
    } = useRoastSummaryForm({ open, summaryData, selectedBeanId, selectedBlendId, planBatchHandoff });

    const roastLevel = watch('roastLevel');
    const formBeanId = watch('beanId');
    const formBlendId = watch('blendId');
    const beanLabel = watch('beanLabel');
    const linkMode = watch('linkMode');
    const formPlanBatchId = watch('planBatchId');
    const deductStock = watch('deductStock');
    const weightGrams = watch('weightGrams');
    const outputWeightKg = watch('outputWeightKg');

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
    const canDeduct = isDeductDisplayEligible({
        customBean: isCustomBean,
        deductionKg,
        resolvedBeanId,
        blendId: effectiveHandoff?.blendId ?? formBlendId ?? null,
    });

    const authUserId = useAuthStore((state) => state.user?.id ?? '');
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: blends = [] } = useBlends(workspaceOwnerId);
    const { hidden: hiddenBeans } = useCatalogVisibility(authUserId, workspaceOwnerId, 'beans');
    const beanComboboxItems = useMemo(
        () => [
            ...beans
                .filter((b) => b.id === formBeanId || b.id === selectedBeanId || !hiddenBeans.has(b.id))
                .map((b) => ({ id: b.id, name: b.name })),
            ...blends.map((b) => ({ id: `blend:${b.id}`, name: b.name })),
        ],
        [beans, blends, formBeanId, selectedBeanId, hiddenBeans],
    );

    if (!open || !summaryData) {
        return null;
    }

    const ambientLine = [
        ambientTemp != null ? `${t('activeRoast.summary.temperature')} ${ambientTemp}°C` : null,
        ambientHumidity != null ? `${t('activeRoast.summary.humidity')} ${ambientHumidity}%` : null,
    ]
        .filter(Boolean)
        .join(' · ');
    // const showBbpAside = bbpEnabled && bbpLive;
    const showBbpAside = false;

    return (
        <>
            <ModalShell
                onClose={onClose}
                dismissable={false}
                labelledBy="roast-summary-modal-title"
                overlayClassName="z-[10000] bg-[rgba(23,23,23,0.12)]"
                contentClassName={`${modalPanel.sm} max-h-[min(720px,calc(100vh-64px))] !p-0 flex flex-col overflow-hidden relative`}
            >
                <button
                    type="button"
                    data-testid="roast-summary-close"
                    onClick={canCancelDrop ? onCancelDrop : onClose}
                    disabled={isSaving}
                    aria-label={t(canCancelDrop ? 'activeRoast.unsaved.cancelDrop' : 'common.close')}
                    className="absolute top-3 right-3 z-10 w-9 h-9 rounded-xl border-none bg-transparent text-muted flex items-center justify-center cursor-pointer transition-colors hover:text-primary hover:bg-surface dark:hover:bg-surface-elevated disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <X size={18} strokeWidth={2.3} />
                </button>
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

                    <div className={`grid grid-cols-3 gap-1.5 ${!showBbpAside && ambientLine ? 'mb-1' : 'mb-3.5'}`}>
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

                    {!showBbpAside && ambientLine ? (
                        <p className="text-[11px] text-muted font-(--font-mono) tracking-[0.14px] mb-3.5">
                            {ambientLine}
                        </p>
                    ) : null}

                    <div className="mb-3.5">
                        <div className={sectionLabelClass}>{t('activeRoast.summary.log')}</div>
                        <div className="flex flex-wrap gap-y-1">
                            {summaryData.logEntries
                                .filter((entry) => isChartEventMarker(entry.event) || entry.event === 'TP')
                                .map((entry, index, entries) => (
                                    <div
                                        key={`${entry.time}-${entry.event}-${index}`}
                                        className="flex items-center gap-1"
                                    >
                                        <span className="text-[11px] font-(--font-mono) text-muted">{entry.time}</span>
                                        <span
                                            className="text-[11px] font-medium"
                                            style={{
                                                color: eventMarkerCssColor(entry.event),
                                            }}
                                        >
                                            {roastEventLabel(entry.event)}
                                        </span>
                                        {index < entries.length - 1 && (
                                            <span className="mx-1 text-border text-xs">·</span>
                                        )}
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
                                            {
                                                value: 'schedule' as const,
                                                label: t('activeRoast.summary.linkSchedule'),
                                            },
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
                                            <p className={formErrorCls}>{errors.planBatchId.message}</p>
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
                                            key={beanFieldEpoch}
                                            data-testid="roast-summary-bean"
                                            items={beanComboboxItems}
                                            selectedId={formBlendId ? `blend:${formBlendId}` : (formBeanId ?? '')}
                                            placeholder={t('activeRoast.summary.beanComboboxPlaceholder')}
                                            emptyLabel={t('activeRoast.summary.beanComboboxEmpty')}
                                            listToggleLabel={t('activeRoast.summary.beanComboboxToggle')}
                                            onSelect={(id) => {
                                                setValue('blendId', id.startsWith('blend:') ? id.slice(6) : null, {
                                                    shouldDirty: true,
                                                    shouldValidate: true,
                                                });
                                                setValue('beanId', id.startsWith('blend:') ? null : id || null, {
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
                                                setValue('blendId', null, { shouldDirty: true, shouldValidate: true });
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
                                        <p className={formErrorCls}>
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
                                max={MAX_BATCH_WEIGHT_KG}
                                step={0.1}
                                data-testid="roast-summary-weight"
                                {...register('weightGrams', { valueAsNumber: true })}
                                placeholder="0.0"
                                className="w-full px-3 py-2 rounded border-none dark:border dark:border-border bg-surface dark:bg-[#262B31] text-primary text-[13px] font-(--font-mono) outline-none box-border"
                            />
                            <span className="text-[11px] text-muted font-semibold tracking-[0.3px]">kg</span>
                        </div>
                        {errors.weightGrams && <p className={formErrorCls}>{errors.weightGrams.message}</p>}
                    </div>

                    <div className="mb-3.5">
                        <div className={sectionLabelClass}>{t('activeRoast.summary.outputWeight')}</div>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={0}
                                max={MAX_BATCH_WEIGHT_KG}
                                step={0.01}
                                {...register('outputWeightKg', { valueAsNumber: true })}
                                placeholder={t('activeRoast.summary.outputWeightPlaceholder')}
                                className="w-full px-3 py-2 rounded border-none dark:border dark:border-border bg-surface dark:bg-[#262B31] text-primary text-[13px] font-(--font-mono) outline-none box-border"
                            />
                            <span className="text-[11px] text-muted font-semibold tracking-[0.3px]">kg</span>
                        </div>
                        {errors.outputWeightKg ? (
                            <p className={formErrorCls}>{errors.outputWeightKg.message}</p>
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
                    {canCancelDrop && (
                        <button
                            type="button"
                            data-testid="roast-summary-cancel-drop"
                            onClick={onCancelDrop}
                            disabled={isSaving}
                            className="w-full py-2.5 rounded-lg bg-surface dark:bg-[#262B31] text-secondary text-sm font-medium cursor-pointer tracking-[0.14px] dark:border dark:border-border disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {t('activeRoast.unsaved.cancelDrop')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={async () => {
                            // 확인 없는 즉시 폐기 방지 (#317) — 창 닫기 가드(#177)와 동급의 한 겹
                            const ok = await ask(t('activeRoast.summary.discardConfirmMsg'), {
                                title: t('activeRoast.summary.discardConfirmTitle'),
                                kind: 'warning',
                                okLabel: t('activeRoast.summary.discardConfirmOk'),
                                cancelLabel: t('activeRoast.summary.discardConfirmCancel'),
                            });
                            if (ok) onDiscard();
                        }}
                        className="w-full py-2.5 rounded-lg bg-surface dark:bg-[#262B31] text-secondary text-sm font-medium cursor-pointer tracking-[0.14px] dark:border dark:border-border"
                    >
                        {t('activeRoast.summary.discard')}
                    </button>
                </div>
            </ModalShell>
            {/*
            {showBbpAside &&
                createPortal(
                    <div className="pointer-events-none fixed inset-0 z-[10001] flex items-center justify-center">
                        <div className="relative w-full max-w-[420px]">
                            <div className="pointer-events-auto absolute top-1/2 left-[calc(100%+20px)] w-[clamp(220px,calc((100vw-480px)/2),320px)] -translate-y-1/2">
                                <RoastSummaryLiveStatus ambientLine={ambientLine || null} />
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
            */}
        </>
    );
};
