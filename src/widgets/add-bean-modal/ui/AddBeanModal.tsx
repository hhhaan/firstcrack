import { useBeanStockSummaries } from '@entities/bean-stock-event';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFormEscape } from '@shared/lib/useFormEscape';
import type { Bean } from '@shared/types/database.types';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { beanFormSchema, EMPTY_BEAN_FORM } from '../lib/schema';
import { tabCls } from '../lib/styles';
import { BEAN_LIST_LIMIT, type BeanModalTab } from '../lib/types';
import { BeanAdjustTab } from './BeanAdjustTab';
import { BeanExpectedTab } from './BeanExpectedTab';
import { BeanFormFields } from './BeanFormFields';
import { BeanRestockTab } from './BeanRestockTab';
import { useAddBeanFormReset } from './useAddBeanFormReset';
import { useAddBeanSubmit } from './useAddBeanSubmit';

interface AddBeanModalProps {
    open: boolean;
    onClose: () => void;
    userId: string;
    existingBeans: Bean[];
    initialTab?: BeanModalTab;
    initialBeanId?: string | null;
    initialData?: Bean | null;
    onSuccess?: (bean: Bean | null) => void;
}

export const AddBeanModal = ({
    open,
    onClose,
    userId,
    existingBeans,
    initialTab = 'new',
    initialBeanId = null,
    initialData = null,
    onSuccess,
}: AddBeanModalProps) => {
    const { t } = useTranslation();
    const [tab, setTab] = useState<BeanModalTab>(initialTab);
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(initialBeanId);
    const [restockAmount, setRestockAmount] = useState('');
    const [restockCost, setRestockCost] = useState('');
    const [expectedAmount, setExpectedAmount] = useState('');
    const [expectedNote, setExpectedNote] = useState('');
    const [adjustType, setAdjustType] = useState<'adjustment' | 'write_off'>('adjustment');
    const [adjustSign, setAdjustSign] = useState<'+' | '-'>('+');
    const [adjustAmount, setAdjustAmount] = useState('');
    const [adjustNote, setAdjustNote] = useState('');
    const [nameIsAuto, setNameIsAuto] = useState(true);
    const [showAllBeans, setShowAllBeans] = useState(false);

    const { data: stockSummaries = {} } = useBeanStockSummaries(userId);

    const form = useForm({
        resolver: zodResolver(beanFormSchema),
        defaultValues: EMPTY_BEAN_FORM,
    });
    const {
        register,
        handleSubmit: rhfSubmit,
        setValue,
        reset,
        getValues,
        formState: { errors },
    } = form;

    const { handleSubmit: submitBean, isSubmitting } = useAddBeanSubmit({
        userId,
        tab,
        selectedBeanId,
        restockAmount,
        restockCost,
        expectedAmount,
        expectedNote,
        adjustType,
        adjustSign,
        adjustAmount,
        adjustNote,
        existingBeans,
        initialData: initialData ?? null,
        onSuccess,
        onClose,
    });

    useFormEscape(open, onClose);

    useAddBeanFormReset({
        open,
        initialTab,
        initialBeanId,
        initialData: initialData ?? null,
        stockSummaries,
        reset,
        setTab,
        setSelectedBeanId,
        setRestockAmount,
        setRestockCost,
        setExpectedAmount,
        setExpectedNote,
        setAdjustType,
        setAdjustSign,
        setAdjustAmount,
        setAdjustNote,
        setShowAllBeans,
        setNameIsAuto,
    });

    const restockGrams = Math.round((parseFloat(restockAmount) || 0) * 1000);
    const expectedGrams = Math.round((parseFloat(expectedAmount) || 0) * 1000);
    const adjustGrams = Math.round((parseFloat(adjustAmount) || 0) * 1000);
    const adjustCurrentGrams = selectedBeanId ? (stockSummaries[selectedBeanId]?.effectiveGrams ?? 0) : 0;
    const isAdjustDeduction = adjustType === 'write_off' || (adjustType === 'adjustment' && adjustSign === '-');
    const adjustExceedsStock = isAdjustDeduction && adjustGrams > 0 && adjustGrams > adjustCurrentGrams;

    const isSubmitDisabled =
        isSubmitting ||
        (tab === 'restock' && (!selectedBeanId || restockGrams <= 0)) ||
        (tab === 'expected' && (!selectedBeanId || expectedGrams <= 0)) ||
        (tab === 'adjust' && (!selectedBeanId || adjustGrams <= 0 || adjustExceedsStock));

    const visibleBeans = showAllBeans ? existingBeans : existingBeans.slice(0, BEAN_LIST_LIMIT);
    const hiddenBeanCount = existingBeans.length - BEAN_LIST_LIMIT;
    const pickerProps = {
        visibleBeans,
        showAllBeans,
        hiddenBeanCount,
        stockSummaries,
        onSelect: setSelectedBeanId,
        onShowAll: () => setShowAllBeans(true),
    };

    const titleKey =
        tab === 'new'
            ? 'addBeanModal.newTitle'
            : tab === 'edit'
              ? 'addBeanModal.editTitle'
              : tab === 'restock'
                ? 'addBeanModal.restockTitle'
                : tab === 'expected'
                  ? 'addBeanModal.expectedTitle'
                  : 'addBeanModal.adjustTitle';

    if (!open) return null;

    return (
        <ModalShell onClose={onClose} labelledBy="add-bean-modal-title" contentClassName={modalPanel.formLg}>
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <ModalHeader
                    titleId="add-bean-modal-title"
                    title={t(titleKey)}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-4"
                />

                {tab !== 'edit' && (
                    <div className="px-8 pb-5">
                        <div className="flex bg-surface p-1 rounded-2xl shadow-(--shadow-inset)">
                            {(['new', 'restock', 'expected', 'adjust'] as const).map((tabKey) => (
                                <button
                                    type="button"
                                    key={tabKey}
                                    onClick={() => setTab(tabKey)}
                                    className={tabCls(tab === tabKey)}
                                >
                                    {t(`addBeanModal.${tabKey === 'new' ? 'newTab' : `${tabKey}Tab`}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <ModalScrollBody contentClassName="p-8">
                {tab === 'adjust' ? (
                    <BeanAdjustTab
                        {...pickerProps}
                        selectedBeanId={selectedBeanId}
                        adjustType={adjustType}
                        adjustSign={adjustSign}
                        adjustAmount={adjustAmount}
                        adjustNote={adjustNote}
                        adjustGrams={adjustGrams}
                        onAdjustTypeChange={setAdjustType}
                        onAdjustSignChange={setAdjustSign}
                        onAdjustAmountChange={setAdjustAmount}
                        onAdjustNoteChange={setAdjustNote}
                    />
                ) : tab === 'new' || tab === 'edit' ? (
                    <FormProvider {...form}>
                        <BeanFormFields
                            register={register}
                            setValue={setValue}
                            getValues={getValues}
                            errors={errors}
                            nameIsAuto={nameIsAuto}
                            setNameIsAuto={setNameIsAuto}
                            onSubmit={submitBean}
                            handleSubmit={rhfSubmit}
                        />
                    </FormProvider>
                ) : tab === 'expected' ? (
                    <BeanExpectedTab
                        {...pickerProps}
                        selectedBeanId={selectedBeanId}
                        expectedAmount={expectedAmount}
                        expectedNote={expectedNote}
                        onExpectedAmountChange={setExpectedAmount}
                        onExpectedNoteChange={setExpectedNote}
                    />
                ) : (
                    <BeanRestockTab
                        {...pickerProps}
                        selectedBeanId={selectedBeanId}
                        restockAmount={restockAmount}
                        onRestockAmountChange={setRestockAmount}
                        restockCost={restockCost}
                        onRestockCostChange={setRestockCost}
                    />
                )}
            </ModalScrollBody>

            <div className="px-8 pt-5 pb-8 bg-white/80 dark:bg-[#1a1e23] backdrop-blur-sm border-t border-black/4 dark:border-[#585d61] shrink-0">
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3.5 rounded-2xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                    >
                        {t('addBeanModal.cancel')}
                    </button>
                    {tab === 'new' || tab === 'edit' ? (
                        <button
                            type="submit"
                            form="bean-form"
                            disabled={isSubmitting}
                            className="flex-2 py-3.5 rounded-2xl border border-transparent bg-primary dark:bg-black text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isSubmitting
                                ? t('addBeanModal.saving')
                                : tab === 'new'
                                  ? t('addBeanModal.create')
                                  : t('addBeanModal.update')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={isSubmitDisabled}
                            onClick={() => submitBean(getValues())}
                            className="flex-2 py-3.5 rounded-2xl border border-transparent bg-primary dark:bg-black text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isSubmitting
                                ? t('addBeanModal.saving')
                                : tab === 'restock'
                                  ? t('addBeanModal.confirmRestock')
                                  : tab === 'expected'
                                    ? t('addBeanModal.confirmExpected')
                                    : adjustType === 'write_off'
                                      ? t('addBeanModal.confirmWriteOff')
                                      : t('addBeanModal.confirmAdjustment')}
                        </button>
                    )}
                </div>
            </div>
        </ModalShell>
    );
};
