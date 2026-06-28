import { Info, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NUMERIC_INPUT_PROPS } from '../lib/numeric-input';
import { inputCls, labelCls } from '../lib/styles';
import type { BeanPickerProps } from '../lib/types';
import { BeanSelector } from './BeanSelector';
import { WarmActionPanel } from './WarmActionPanel';

type Props = BeanPickerProps & {
    expectedAmount: string;
    expectedNote: string;
    onExpectedAmountChange: (amount: string) => void;
    onExpectedNoteChange: (note: string) => void;
};

export const BeanExpectedTab = ({
    selectedBeanId,
    expectedAmount,
    expectedNote,
    onExpectedAmountChange,
    onExpectedNoteChange,
    ...pickerProps
}: Props) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-6">
            <BeanSelector label={t('addBeanModal.selectBean')} {...pickerProps} selectedBeanId={selectedBeanId} />

            <WarmActionPanel enabled={!!selectedBeanId}>
                <label className={labelCls}>
                    <Scale size={14} /> {t('addBeanModal.expected.inbound')}
                </label>
                <div className="flex items-center gap-3">
                    <input
                        {...NUMERIC_INPUT_PROPS}
                        className={`${inputCls} text-2xl font-semibold p-4`}
                        placeholder="0"
                        value={expectedAmount}
                        onChange={(e) => onExpectedAmountChange(e.target.value.replace(/[^0-9.]/g, ''))}
                    />
                    <div className="text-lg font-medium text-muted">kg</div>
                </div>
                <label className={`${labelCls} mt-4`}>
                    <Info size={14} /> {t('addBeanModal.expected.note')}
                </label>
                <input
                    className={inputCls}
                    placeholder={t('addBeanModal.expected.notePlaceholder')}
                    value={expectedNote}
                    onChange={(e) => onExpectedNoteChange(e.target.value)}
                />
                <p className="text-xs text-muted mt-3">{t('addBeanModal.expected.countsNote')}</p>
            </WarmActionPanel>
        </div>
    );
};
