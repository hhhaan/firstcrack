import { inputCls, labelCls, tabCls } from '@shared/ui/form-styles';
import { NUMERIC_INPUT_PROPS } from '@shared/ui/numeric-input';
import { Info, Scale } from 'lucide-react';
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
    const isDeduction = adjustType === 'write_off' || (adjustType === 'adjustment' && adjustSign === '-');
    const currentGrams = selectedBeanId ? (stockSummaries[selectedBeanId]?.effectiveGrams ?? 0) : 0;
    const exceedsStock = isDeduction && adjustGrams > 0 && adjustGrams > currentGrams;

    return (
        <div className="flex flex-col gap-6">
            <BeanSelector
                label={t('addBeanModal.selectBean')}
                {...pickerProps}
                stockSummaries={stockSummaries}
                selectedBeanId={selectedBeanId}
            />

            <WarmActionPanel enabled={!!selectedBeanId} className="flex flex-col gap-4">
                <div className="flex bg-surface p-1 rounded-xl shadow-(--shadow-inset)">
                    <button
                        type="button"
                        onClick={() => onAdjustTypeChange('adjustment')}
                        className={tabCls(adjustType === 'adjustment')}
                    >
                        {t('addBeanModal.adjust.adjustment')}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            onAdjustTypeChange('write_off');
                            onAdjustSignChange('+');
                        }}
                        className={tabCls(adjustType === 'write_off')}
                    >
                        {t('addBeanModal.adjust.writeOff')}
                    </button>
                </div>

                <div>
                    <label className={labelCls}>
                        <Scale size={14} /> {t('addBeanModal.adjust.amount')}
                    </label>
                    <div className="flex items-center gap-3">
                        {adjustType === 'adjustment' && (
                            <div className="flex rounded-xl overflow-hidden border border-black/8 dark:border-[#585d61] shrink-0">
                                {(['+', '-'] as const).map((sign) => (
                                    <button
                                        key={sign}
                                        type="button"
                                        onClick={() => onAdjustSignChange(sign)}
                                        className={`w-11 h-full text-lg font-semibold transition-all duration-150 ${
                                            adjustSign === sign
                                                ? 'bg-primary text-white dark:bg-black'
                                                : 'bg-white/80 dark:bg-surface-elevated text-muted'
                                        }`}
                                    >
                                        {sign}
                                    </button>
                                ))}
                            </div>
                        )}
                        <input
                            {...NUMERIC_INPUT_PROPS}
                            className={`${inputCls} text-2xl font-semibold p-4`}
                            placeholder="0"
                            value={adjustAmount}
                            onChange={(e) => onAdjustAmountChange(e.target.value.replace(/[^0-9.]/g, ''))}
                        />
                        <div className="text-lg font-medium text-muted shrink-0">kg</div>
                    </div>
                    {exceedsStock && (
                        <p className="text-xs text-amber-500 dark:text-amber-400 mt-2">
                            {t('addBeanModal.adjust.exceedsStock', {
                                amount: (currentGrams / 1000).toFixed(2),
                            })}
                        </p>
                    )}
                </div>

                <div>
                    <label className={labelCls}>
                        <Info size={14} /> {t('addBeanModal.adjust.reason')}
                    </label>
                    <input
                        className={inputCls}
                        placeholder={
                            adjustType === 'write_off'
                                ? t('addBeanModal.adjust.writeOffPlaceholder')
                                : t('addBeanModal.adjust.adjustPlaceholder')
                        }
                        value={adjustNote}
                        onChange={(e) => onAdjustNoteChange(e.target.value)}
                    />
                </div>
            </WarmActionPanel>
        </div>
    );
};
