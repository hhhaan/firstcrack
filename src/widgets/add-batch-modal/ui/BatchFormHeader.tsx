import type { Machine } from '@entities/machine';
import { getDateFnsLocale } from '@shared/i18n';
import { cn } from '@shared/lib/cn';
import { Calendar } from '@shared/ui/calendar/Calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { format } from 'date-fns';
import { CalendarIcon, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { inputCls, labelCls } from '../lib/styles';
import { SearchableSelect } from './SearchableSelect';

type Props = {
    date: Date | undefined;
    calendarOpen: boolean;
    isDateDisabled: boolean;
    dateChanged: boolean;
    machineId: string;
    machines: Machine[];
    onDateChange: (d: Date | undefined) => void;
    onCalendarOpenChange: (open: boolean) => void;
    onMachineSelect: (id: string) => void;
};

export const BatchFormHeader = ({
    date,
    calendarOpen,
    isDateDisabled,
    dateChanged,
    machineId,
    machines,
    onDateChange,
    onCalendarOpenChange,
    onMachineSelect,
}: Props) => {
    const { t } = useTranslation();

    return (
        <div className="grid grid-cols-2 gap-4">
            <div>
                <label className={labelCls}>
                    <CalendarIcon size={12} /> {t('addBatchModal.date')}
                </label>
                <Popover
                    open={calendarOpen}
                    onOpenChange={(open) => {
                        if (!isDateDisabled) onCalendarOpenChange(open);
                    }}
                >
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            disabled={isDateDisabled}
                            className={cn(
                                inputCls,
                                'flex items-center gap-2 text-left',
                                !isDateDisabled && 'cursor-pointer',
                                isDateDisabled && 'opacity-60 cursor-not-allowed',
                                !date && 'text-muted',
                            )}
                        >
                            <CalendarIcon size={13} className="text-muted shrink-0" />
                            <span>
                                {date
                                    ? format(date, t('addBatchModal.dateFormat'), { locale: getDateFnsLocale() })
                                    : t('addBatchModal.date')}
                            </span>
                            {dateChanged && (
                                <span className="ml-auto text-[10px] text-amber-600 font-semibold shrink-0">
                                    {t('addBatchModal.moved')}
                                </span>
                            )}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={date}
                            onSelect={(d) => {
                                onDateChange(d);
                                onCalendarOpenChange(false);
                            }}
                            locale={getDateFnsLocale()}
                        />
                    </PopoverContent>
                </Popover>
            </div>
            <div>
                <label className={labelCls}>
                    <Cpu size={12} /> {t('addBatchModal.machine')}
                </label>
                <SearchableSelect
                    placeholder={t('addBatchModal.machine')}
                    items={machines}
                    selectedId={machineId}
                    onSelect={onMachineSelect}
                    renderLabel={(item) => {
                        const m = item as Machine;
                        return m.name || m.displayName;
                    }}
                    renderOption={(item) => {
                        const m = item as Machine;
                        return (
                            <div>
                                <div className="text-primary font-medium">{m.name || m.displayName}</div>
                                <div className="text-[11px] text-muted mt-0.5">{m.brand}</div>
                            </div>
                        );
                    }}
                />
            </div>
        </div>
    );
};
