import { AdjustStockFields } from '@shared/ui/AdjustStockFields';
import { useTranslation } from 'react-i18next';
import type { BeanPickerProps } from '../lib/types';
import { BeanSelector } from './BeanSelector';
import { WarmActionPanel } from './WarmActionPanel';

type Props = BeanPickerProps & {
    adjustType: 'adjustment' | 'write_off';
    adjustSign: '+' | '-';
    adjustAmount: string;
    adjustNote: string;
    adjustGrams: number;
    onAdjustTypeChange: (type: 'adjustment' | 'write_off') => void;
    onAdjustSignChange: (sign: '+' | '-') => void;
    onAdjustAmountChange: (amount: string) => void;
    onAdjustNoteChange: (note: string) => void;
};

export const BeanAdjustTab = ({
    selectedBeanId,
    adjustType,
    adjustSign,
    adjustAmount,
    adjustNote,
    adjustGrams,
    stockSummaries,
    onAdjustTypeChange,
    onAdjustSignChange,
    onAdjustAmountChange,
    onAdjustNoteChange,
    ...pickerProps
}: Props) => {
    const { t } = useTranslation();
    const currentGrams = selectedBeanId ? (stockSummaries[selectedBeanId]?.effectiveGrams ?? 0) : 0;
    const selected = pickerProps.visibleBeans.find((b) => b.id === selectedBeanId);

    return (
        <div className="flex flex-col gap-6">
            <BeanSelector
                label={t('addBeanModal.selectBean')}
                {...pickerProps}
                stockSummaries={stockSummaries}
                selectedBeanId={selectedBeanId}
            />

            <WarmActionPanel enabled={!!selectedBeanId} className="flex flex-col gap-4">
                <AdjustStockFields
                    name={selected?.name ?? ''}
                    unitLabel="kg"
                    amountMode="decimal"
                    type={adjustType}
                    sign={adjustSign}
                    amount={adjustAmount}
                    note={adjustNote}
                    amountValue={adjustGrams / 1000}
                    currentStock={currentGrams / 1000}
                    onTypeChange={onAdjustTypeChange}
                    onSignChange={onAdjustSignChange}
                    onAmountChange={onAdjustAmountChange}
                    onNoteChange={onAdjustNoteChange}
                    embedded
                />
            </WarmActionPanel>
        </div>
    );
};
