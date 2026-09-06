import { inputCls, labelCls, tabCls } from '@shared/ui/form-styles';
import { Info, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AdjustStockSign, AdjustStockType } from '../lib/signedDelta';

type Props = {
    /** Target display name (bean / product) */
    name: string;
    /** Optional kind chip under the name */
    kindLabel?: string;
    /** e.g. "2.40 kg" or "12 봉" */
    currentStockLabel?: string;
    /** Unit suffix next to amount input */
    unitLabel: string;
    amountMode: 'decimal' | 'integer';
    type: AdjustStockType;
    sign: AdjustStockSign;
    amount: string;
    note: string;
    /** Parsed positive magnitude for exceed check */
    amountValue: number;
    /** Current stock in same unit as amountValue (kg or bags) */
    currentStock?: number;
    onTypeChange: (type: AdjustStockType) => void;
    onSignChange: (sign: AdjustStockSign) => void;
    onAmountChange: (amount: string) => void;
    onNoteChange: (note: string) => void;
};

/**
 * Shared adjust / write-off fields — visual parity with BeanAdjustTab + form-styles.
 */
export const AdjustStockFields = ({
    name,
    kindLabel,
    currentStockLabel,
    unitLabel,
    amountMode,
    type,
    sign,
    amount,
    note,
    amountValue,
    currentStock,
    onTypeChange,
    onSignChange,
    onAmountChange,
    onNoteChange,
}: Props) => {
    const { t } = useTranslation();
    const isDeduction = type === 'write_off' || (type === 'adjustment' && sign === '-');
    const exceedsStock = isDeduction && currentStock != null && amountValue > 0 && amountValue > currentStock;

    return (
        <div className="flex flex-col gap-5">
            <div className="rounded-2xl border border-border-subtle bg-surface/60 px-4 py-3.5 dark:border-[#585d61] dark:bg-surface-elevated/40">
                <p className="text-[15px] font-semibold tracking-[0.14px] text-primary">{name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                    {kindLabel ? (
                        <span className="rounded-full bg-main-bg px-2 py-0.5 text-[11px] font-medium text-muted dark:bg-surface">
                            {kindLabel}
                        </span>
                    ) : null}
                    {currentStockLabel ? (
                        <span className="font-mono text-[12px] text-secondary">
                            {t('inventory.adjust.currentStock', { stock: currentStockLabel })}
                        </span>
                    ) : null}
                </div>
            </div>

            <div
                className="flex flex-col gap-5 rounded-[20px] p-6"
                style={{
                    background: 'var(--color-surface-warm-solid)',
                    boxShadow: 'var(--shadow-warm)',
                }}
            >
                <div className="flex rounded-xl bg-surface p-1 shadow-(--shadow-inset)">
                    <button
                        type="button"
                        onClick={() => onTypeChange('adjustment')}
                        className={tabCls(type === 'adjustment')}
                    >
                        {t('inventory.adjust.adjustment')}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            onTypeChange('write_off');
                            onSignChange('+');
                        }}
                        className={tabCls(type === 'write_off')}
                    >
                        {t('inventory.adjust.writeOff')}
                    </button>
                </div>

                <div>
                    <label className={labelCls} htmlFor="adjust-stock-amount">
                        <Scale size={14} strokeWidth={2} />
                        {t('inventory.adjust.amount')}
                    </label>
                    <div className="flex items-stretch gap-3">
                        {type === 'adjustment' && (
                            <div className="flex shrink-0 overflow-hidden rounded-xl border border-black/8 dark:border-[#585d61]">
                                {(['+', '-'] as const).map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => onSignChange(s)}
                                        className={`w-11 text-lg font-semibold transition-all duration-150 ${
                                            sign === s
                                                ? 'bg-primary text-white dark:bg-black'
                                                : 'bg-white/80 text-muted dark:bg-surface-elevated'
                                        }`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}
                        <input
                            id="adjust-stock-amount"
                            type="text"
                            inputMode={amountMode === 'integer' ? 'numeric' : 'decimal'}
                            autoComplete="off"
                            className={`${inputCls} flex-1 p-4 text-2xl font-semibold`}
                            placeholder="0"
                            value={amount}
                            onChange={(e) => {
                                const re = amountMode === 'integer' ? /[^0-9]/g : /[^0-9.]/g;
                                onAmountChange(e.target.value.replace(re, ''));
                            }}
                        />
                        <div className="flex shrink-0 items-center text-lg font-medium text-muted">{unitLabel}</div>
                    </div>
                    {exceedsStock && currentStock != null ? (
                        <p className="mt-2 text-xs text-amber-500 dark:text-amber-400">
                            {t('inventory.adjust.exceedsStock', {
                                amount: amountMode === 'integer' ? String(currentStock) : currentStock.toFixed(2),
                            })}
                        </p>
                    ) : null}
                </div>

                <div>
                    <label className={labelCls} htmlFor="adjust-stock-note">
                        <Info size={14} strokeWidth={2} />
                        {t('inventory.adjust.reason')}
                    </label>
                    <input
                        id="adjust-stock-note"
                        className={inputCls}
                        value={note}
                        onChange={(e) => onNoteChange(e.target.value)}
                        placeholder={
                            type === 'write_off'
                                ? t('inventory.adjust.writeOffPlaceholder')
                                : t('inventory.adjust.adjustPlaceholder')
                        }
                    />
                </div>
            </div>
        </div>
    );
};
