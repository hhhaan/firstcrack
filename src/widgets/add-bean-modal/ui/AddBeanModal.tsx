import { useBeanStockSummaries } from '@entities/bean-stock-event';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFormEscape } from '@shared/lib/useFormEscape';
import type { Bean } from '@shared/types/database.types';
import {
    modalCancelBtnCls,
    modalFooterChrome,
    modalHeaderChrome,
    modalPrimaryBtnCls,
    tabCls,
} from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { beanFormSchema, EMPTY_BEAN_FORM } from '../lib/schema';
import { BEAN_LIST_LIMIT, type BeanModalTab } from '../lib/types';
import { BeanAdjustTab } from './BeanAdjustTab';
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
    const [adjustType, setAdjustType] = useState<'adjustment' | 'write_off'>('adjustment');
    const [adjustSign, setAdjustSign] = useState<'+' | '-'>('+');
    const [adjustAmount, setAdjustAmount] = useState('');
    const [adjustNote, setAdjustNote] = useState('');
    const [nameIsAuto, setNameIsAuto] = useState(true);
    const [showAllBeans, setShowAllBeans] = useState(false);

    const { data: stockSummaries = {} } = useBeanStockSummaries(userId);

    const form = useForm({
        resolver: zodResolver(beanFormSchema(t)),
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
        setAdjustType,
        setAdjustSign,
        setAdjustAmount,
        setAdjustNote,
        setShowAllBeans,
        setNameIsAuto,
    });

    const restockGrams = Math.round((parseFloat(restockAmount) || 0) * 1000);
    const adjustGrams = Math.round((parseFloat(adjustAmount) || 0) * 1000);
    const adjustCurrentGrams = selectedBeanId ? (stockSummaries[selectedBeanId]?.effectiveGrams ?? 0) : 0;
    const isAdjustDeduction = adjustType === 'write_off' || (adjustType === 'adjustment' && adjustSign === '-');
    const adjustExceedsStock = isAdjustDeduction && adjustGrams > 0 && adjustGrams > adjustCurrentGrams;

    const isSubmitDisabled =
        isSubmitting ||
        (tab === 'restock' && (!selectedBeanId || restockGrams <= 0)) ||
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
                : 'addBeanModal.adjustTitle';

    if (!open) return null;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="add-bean-modal-title"
            contentClassName={modalPanel.formLg}
            data-testid="add-bean-modal"
        >
            <div className={modalHeaderChrome}>
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
                            {(['new', 'restock', 'adjust'] as const).map((tabKey) => (
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

            <div className={modalFooterChrome}>
                <div className="flex gap-3">
                    <button type="button" onClick={onClose} className={modalCancelBtnCls}>
                        {t('addBeanModal.cancel')}
                    </button>
                    {tab === 'new' || tab === 'edit' ? (
                        <button
                            type="submit"
                            form="bean-form"
                            data-testid="bean-form-submit"
                            disabled={isSubmitting}
                            className={`${modalPrimaryBtnCls} flex-[2]`}
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
                            className={`${modalPrimaryBtnCls} flex-[2]`}
                        >
                            {isSubmitting
                                ? t('addBeanModal.saving')
                                : tab === 'restock'
                                  ? t('addBeanModal.confirmRestock')
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
