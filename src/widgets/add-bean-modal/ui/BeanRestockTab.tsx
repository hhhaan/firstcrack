import { Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NUMERIC_INPUT_PROPS } from '../lib/numeric-input';
import { inputCls, labelCls } from '../lib/styles';
import type { BeanPickerProps } from '../lib/types';
import { BeanSelector } from './BeanSelector';
import { WarmActionPanel } from './WarmActionPanel';

type Props = BeanPickerProps & {
    restockAmount: string;
    onRestockAmountChange: (amount: string) => void;
};

export const BeanRestockTab = ({ selectedBeanId, restockAmount, onRestockAmountChange, ...pickerProps }: Props) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-6">
            <BeanSelector
                label={t('addBeanModal.selectBeanRestock')}
                {...pickerProps}
                selectedBeanId={selectedBeanId}
            />

            <WarmActionPanel enabled={!!selectedBeanId}>
                <label className={labelCls}>
                    <Scale size={14} /> {t('addBeanModal.restock.weight')}
                </label>
                <div className="flex items-center gap-3">
                    <input
                        {...NUMERIC_INPUT_PROPS}
                        className={`${inputCls} text-2xl font-semibold p-4`}
                        placeholder="0"
                        value={restockAmount}
                        onChange={(e) => onRestockAmountChange(e.target.value.replace(/[^0-9.]/g, ''))}
                    />
                    <div className="text-lg font-medium text-muted">kg</div>
                </div>

                <div className="flex gap-2 mt-4">
                    {[
                        { label: '+0.5kg', amount: 0.5 },
                        { label: '+1kg', amount: 1 },
                    ].map(({ label, amount }) => (
                        <button
                            key={amount}
                            type="button"
                            onClick={() => {
                                const parsed = parseFloat(restockAmount) || 0;
                                onRestockAmountChange((Math.round((parsed + amount) * 1000) / 1000).toString());
                            }}
                            className="flex-1 py-3 px-4 rounded-xl border border-black/12 dark:border-[#585d61] bg-white dark:bg-surface-elevated text-primary text-sm font-semibold cursor-pointer transition-all duration-200"
                        >
                            {label}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => onRestockAmountChange('')}
                        className="py-3 px-5 rounded-xl border border-black/12 dark:border-[#585d61] bg-white dark:bg-surface-elevated text-[#e74c3c] dark:text-red-400 text-sm font-semibold cursor-pointer"
                    >
                        {t('addBeanModal.restock.clear')}
                    </button>
                </div>
            </WarmActionPanel>
        </div>
    );
};
