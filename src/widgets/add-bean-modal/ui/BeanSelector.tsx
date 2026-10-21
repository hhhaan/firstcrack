import type { Bean } from '@shared/types/database.types';
import { labelCls } from '@shared/ui/form-styles';
import { Check, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BeanPickerProps } from '../lib/types';

type Props = BeanPickerProps & {
    label: string;
};

export const BeanSelector = ({
    label,
    visibleBeans,
    selectedBeanId,
    showAllBeans,
    hiddenBeanCount,
    stockSummaries,
    onSelect,
    onShowAll,
}: Props) => {
    const { t } = useTranslation();
    return (
        <div>
            <label className={labelCls}>
                <Search size={14} /> {label}
            </label>
            <div className="grid gap-2.5 p-1">
                {visibleBeans.map((bean: Bean) => {
                    const isSelected = selectedBeanId === bean.id;
                    return (
                        <div
                            key={bean.id}
                            onClick={() => onSelect(bean.id)}
                            className={`px-4.5 py-3.5 rounded-2xl border border-black/6 dark:border-border flex items-center justify-between cursor-pointer transition-[color,background-color,box-shadow,opacity] duration-200 ${
                                isSelected
                                    ? 'bg-action text-on-action shadow-[0_8px_20px_rgba(0,0,0,0.12)]'
                                    : 'bg-white/70 dark:bg-surface-elevated text-primary shadow-(--shadow-ring)'
                            }`}
                        >
                            <div>
                                <div className="text-sm font-semibold">{bean.name}</div>
                                <div className="text-xs opacity-70">
                                    {bean.origin ?? '—'} · {bean.process ?? '—'}
                                </div>
                            </div>
                            {isSelected ? (
                                <Check size={18} strokeWidth={2.5} />
                            ) : (
                                <div className="text-[13px] font-mono opacity-60">
                                    {((stockSummaries[bean.id]?.currentGrams ?? 0) / 1000).toFixed(2)}
                                    kg
                                </div>
                            )}
                        </div>
                    );
                })}
                {!showAllBeans && hiddenBeanCount > 0 && (
                    <button
                        type="button"
                        onClick={onShowAll}
                        className="py-2.5 rounded-2xl border border-black/6 dark:border-border bg-white/50 dark:bg-surface-elevated text-sm font-medium text-muted cursor-pointer hover:bg-white/80 dark:hover:bg-[#262b31] transition-[color,background-color,box-shadow,opacity] duration-200"
                    >
                        {t('addBeanModal.more', { count: hiddenBeanCount })}
                    </button>
                )}
            </div>
        </div>
    );
};
