import { cn } from '@shared/lib/cn';
import type { RecurrenceInterval } from '@shared/lib/rrule';
import { labelCls } from '@shared/ui/form-styles';
import { AlertTriangle, Repeat } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RECURRENCE_OPTIONS } from '../lib/types';

type Props = {
    recurringInterval: RecurrenceInterval | null;
    recurringHorizonShort: { neededKg: string; availableKg: string } | null;
    onRecurringIntervalChange: (v: RecurrenceInterval | null) => void;
};

export const BatchRecurrenceFields = ({
    recurringInterval,
    recurringHorizonShort,
    onRecurringIntervalChange,
}: Props) => {
    const { t } = useTranslation();

    return (
        <div>
            <label className={labelCls}>
                <Repeat size={12} /> {t('addBatchModal.recurrence')}
            </label>
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => onRecurringIntervalChange(null)}
                    className={cn(
                        'px-3 py-2 rounded-xl text-[13px] font-medium transition-all border',
                        recurringInterval === null
                            ? 'bg-primary text-white dark:bg-transparent dark:text-secondary dark:border-[#585d61] border-primary shadow-sm dark:shadow-none'
                            : 'bg-surface dark:bg-surface-elevated text-secondary border-border dark:border-[#585d61] hover:border-black/15',
                    )}
                >
                    {t('addBatchModal.none')}
                </button>
                {RECURRENCE_OPTIONS.map(({ value }) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => onRecurringIntervalChange(value)}
                        className={cn(
                            'px-3 py-2 rounded-xl text-[13px] font-medium transition-all border',
                            recurringInterval === value
                                ? 'bg-primary text-white dark:bg-transparent dark:text-secondary dark:border-[#585d61] border-primary shadow-sm dark:shadow-none'
                                : 'bg-surface dark:bg-surface-elevated text-secondary border-border dark:border-[#585d61] hover:border-black/15',
                        )}
                    >
                        {t(`schedule.recurrence.${value}`)}
                    </button>
                ))}
            </div>
            {recurringHorizonShort && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50 px-3.5 py-2.5">
                    <AlertTriangle size={14} strokeWidth={2} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                        {t('addBatchModal.recurringStockShort', {
                            needed: recurringHorizonShort.neededKg,
                            available: recurringHorizonShort.availableKg,
                        })}
                    </p>
                </div>
            )}
        </div>
    );
};
