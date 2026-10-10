import { useBeans } from '@entities/bean/queries';
import { useBeanStockSummaries } from '@entities/bean-stock-event';
import { useBlends } from '@entities/blend';
import { useMachines } from '@entities/machine';
import { useActiveWorkspace } from '@entities/organization';
import { useProfile } from '@entities/profile';
import { useRoastProfiles } from '@entities/roast-profile/queries';
import { getDateFnsLocale } from '@shared/i18n';
import type { RecurrenceInterval } from '@shared/lib/rrule';
import { useFormEscape } from '@shared/lib/useFormEscape';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deriveBatchQuantities } from '../lib/batch-quantities';
import { buildNewBatchPayload } from '../lib/build-new-batch-payload';
import type { BatchType, EditScope, NewBatchData } from '../lib/types';
import { DEFAULT_BATCH_SIZE } from '../lib/types';
import { BatchFormHeader } from './BatchFormHeader';
import { BatchQuantityFields } from './BatchQuantityFields';
import { BatchRecurrenceFields } from './BatchRecurrenceFields';
import { BatchSourceFields } from './BatchSourceFields';
import { BatchStockPanel } from './BatchStockPanel';
import { BatchTypeTabs } from './BatchTypeTabs';
import { useBatchFormReset } from './useBatchFormReset';
import { useBatchStockChecks } from './useBatchStockChecks';

export type { EditScope, NewBatchData } from '../lib/types';

interface AddBatchModalProps {
    open: boolean;
    onClose: () => void;
    onSave?: (data: NewBatchData) => Promise<void>;
    editingBatch?: PlanBatchWithProgress | null;
    editScope?: EditScope | null;
    currentDateKey?: string;
    onSaved?: () => void;
}

export const AddBatchModal = ({
    open,
    onClose,
    onSave,
    editingBatch,
    editScope,
    currentDateKey,
    onSaved,
}: AddBatchModalProps) => {
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { t } = useTranslation();

    const { data: beans = [] } = useBeans(userId);
    const { data: stockSummaries = {} } = useBeanStockSummaries(userId);
    const { machines } = useMachines();
    const { data: profiles = [] } = useRoastProfiles(userId);
    const { data: userProfile } = useProfile(userId);
    const { data: blends = [] } = useBlends(userId);

    const isEdit = !!editingBatch;
    const isDateDisabled = editScope === 'all';
    const isRruleVisible = !isEdit || editScope === 'from_this' || editScope === 'all';

    const [saving, setSaving] = useState(false);
    const [date, setDate] = useState<Date | undefined>();
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [recurringInterval, setRecurringInterval] = useState<RecurrenceInterval | null>(null);
    const [machineId, setMachineId] = useState('');
    const [batchType, setBatchType] = useState<BatchType>('Single Origin');
    const [profileId, setProfileId] = useState('');
    const [beanId, setBeanId] = useState('');
    const [blendId, setBlendId] = useState<string | null>(null);
    const [targetRoasted, setTargetRoasted] = useState('');
    const [batchSize, setBatchSize] = useState('');
    const [yieldPct, setYieldPct] = useState('');
    const [notes, setNotes] = useState('');

    useFormEscape(open, onClose);

    useBatchFormReset({
        open,
        editingBatch: editingBatch ?? null,
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
    });

    const targetNum = parseFloat(targetRoasted) || 0;
    const batchSizeNum = parseFloat(batchSize) || DEFAULT_BATCH_SIZE;
    const yieldNum = parseFloat(yieldPct) || 82;
    const { batchCount, greenNeededKg, plannedGrams } = deriveBatchQuantities(targetNum, batchSizeNum, yieldNum);

    const selectedBean = beans.find((b) => b.id === beanId);
    const selectedProfile = profiles.find((p) => p.id === profileId);
    const selectedMachine = machines.find((m) => m.id === machineId);
    const selectedBlend = blends.find((b) => b.id === blendId);
    const selectedBeanId = batchType === 'Single Origin' ? beanId : null;
    const stockSummary = selectedBeanId ? stockSummaries[selectedBeanId] : undefined;

    const stockChecks = useBatchStockChecks({
        batchType,
        beanId,
        blendId,
        selectedBlend,
        selectedBeanId,
        stockSummary,
        stockSummaries,
        plannedGrams,
        recurringInterval,
        date,
        batchSizeNum,
        batchCount,
    });

    const handleProfileSelect = (id: string) => {
        setProfileId(id);
        if (!id) return;
        const selected = profiles.find((p) => p.id === id);
        if (selected?.default_bean_id) {
            setBatchType('Single Origin');
            setBeanId(selected.default_bean_id);
        } else if (selected?.default_blend_id) {
            setBatchType('Pre-roast Blend');
            setBlendId(selected.default_blend_id);
        }
    };

    const newDateKey = date ? format(date, 'yyyy-MM-dd') : '';
    const originalDateKey = editingBatch?.scheduled_date ?? currentDateKey;
    const dateChanged = isEdit && !!originalDateKey && newDateKey !== originalDateKey;
    const canSubmit = date !== undefined && !!machineId && targetNum > 0 && batchSizeNum > 0 && !saving;

    const handleSubmit = async () => {
        if (!canSubmit || !date || !onSave) return;

        const isBlendType = batchType === 'Pre-roast Blend' || batchType === 'Post-roast Blend';
        const effectiveStockKg = (stockSummary?.effectiveGrams ?? 0) / 1000;

        setSaving(true);
        try {
            await onSave(
                buildNewBatchPayload({
                    date,
                    machineId,
                    machineName: selectedMachine?.name ?? selectedMachine?.displayName ?? machineId,
                    batchType,
                    profileId: profileId || null,
                    profileName: selectedProfile?.name ?? '',
                    beanId: beanId || null,
                    blendId: blendId || null,
                    beanName: isBlendType ? (selectedBlend?.name ?? '') : (selectedBean?.name ?? ''),
                    targetRoasted: targetNum,
                    batchSize: batchSizeNum,
                    yieldPct: yieldNum,
                    batchCount,
                    greenNeeded: greenNeededKg,
                    greenLot: selectedBean ? `${selectedBean.name} (${effectiveStockKg.toFixed(0)}kg)` : '',
                    notes,
                    recurringInterval: recurringInterval ?? undefined,
                }),
            );
            onSaved?.();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const beanItems = useMemo(() => beans.map((b) => ({ ...b })), [beans]);
    const defaultProfileId = userProfile?.default_roast_profile_id;
    const profileItems = useMemo(
        () =>
            [...profiles]
                .sort((a, b) => {
                    if (!defaultProfileId) return 0;
                    if (a.id === defaultProfileId) return -1;
                    if (b.id === defaultProfileId) return 1;
                    return 0;
                })
                .map((p) => ({ ...p })),
        [profiles, defaultProfileId],
    );

    if (!open) return null;

    return (
        <ModalShell onClose={onClose} labelledBy="add-batch-modal-title" contentClassName={modalPanel.formMd}>
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm border-b border-black/4 dark:border-[#585d61]">
                <ModalHeader
                    titleId="add-batch-modal-title"
                    title={isEdit ? t('addBatchModal.editBatch') : t('addBatchModal.addBatch')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                    titleClassName="font-(--font-display) text-[22px] text-primary tracking-[-0.02em] m-0"
                    subtitle={
                        isEdit && editingBatch ? (
                            <p className="text-[12px] text-muted mt-0.5 m-0">{editingBatch.bean_name}</p>
                        ) : undefined
                    }
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-6">
                <BatchFormHeader
                    date={date}
                    calendarOpen={calendarOpen}
                    isDateDisabled={isDateDisabled}
                    dateChanged={dateChanged}
                    machineId={machineId}
                    machines={machines}
                    onDateChange={setDate}
                    onCalendarOpenChange={setCalendarOpen}
                    onMachineSelect={setMachineId}
                />

                <BatchTypeTabs batchType={batchType} onBatchTypeChange={setBatchType} />

                <BatchSourceFields
                    batchType={batchType}
                    profileId={profileId}
                    beanId={beanId}
                    blendId={blendId}
                    profileItems={profileItems}
                    beanItems={beanItems}
                    blends={blends}
                    stockSummaries={stockSummaries}
                    plannedGrams={plannedGrams}
                    stockSummaryEffectiveGrams={stockSummary?.effectiveGrams}
                    stockChecks={stockChecks}
                    onProfileSelect={handleProfileSelect}
                    onBeanSelect={setBeanId}
                    onBlendSelect={setBlendId}
                />

                <BatchQuantityFields
                    targetRoasted={targetRoasted}
                    batchSize={batchSize}
                    yieldPct={yieldPct}
                    targetNum={targetNum}
                    batchCount={batchCount}
                    greenNeeded={greenNeededKg}
                    yieldNum={yieldNum}
                    onTargetRoastedChange={setTargetRoasted}
                    onBatchSizeChange={setBatchSize}
                    onYieldPctChange={setYieldPct}
                />

                <BatchStockPanel
                    selectedBean={stockSummary ? selectedBean : undefined}
                    effectiveStockKg={stockChecks.effectiveStockKg}
                    greenNeeded={stockChecks.greenNeeded}
                    stockSufficient={stockChecks.stockSufficient}
                    stockPct={stockChecks.stockPct}
                />

                {isRruleVisible && (
                    <BatchRecurrenceFields
                        recurringInterval={recurringInterval}
                        recurringHorizonShort={stockChecks.recurringHorizonShort}
                        onRecurringIntervalChange={setRecurringInterval}
                    />
                )}

                <div>
                    <label className={labelCls}>{t('addBatchModal.notes')}</label>
                    <textarea
                        className={`${inputCls} resize-none`}
                        rows={3}
                        placeholder={t('addBatchModal.notesPlaceholder')}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </div>
            </ModalScrollBody>

            <div className="shrink-0 border-t border-black/4 dark:border-[#585d61] bg-white/60 dark:bg-[#1a1e23] px-8 py-4 flex items-center justify-between gap-3">
                {dateChanged && newDateKey && (
                    <p className="text-[12px] text-amber-600 font-medium">
                        {t('addBatchModal.dateChanged', {
                            date: format(new Date(`${newDateKey}T00:00:00`), t('addBatchModal.dateFormatShort'), {
                                locale: getDateFnsLocale(),
                            }),
                        })}
                    </p>
                )}
                <div className="flex items-center gap-3 ml-auto">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-xl border border-border dark:border-0 bg-surface dark:bg-surface-elevated text-secondary text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors shadow-(--shadow-inset)"
                    >
                        {t('addBatchModal.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="px-5 py-2.5 rounded-xl border border-transparent bg-primary dark:bg-black text-white dark:text-[#e5e5e5] text-[13px] font-semibold cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {saving
                            ? t('addBatchModal.saving')
                            : isEdit
                              ? t('addBatchModal.save')
                              : t('addBatchModal.addBatch')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};
