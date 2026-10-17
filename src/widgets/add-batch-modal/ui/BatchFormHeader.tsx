import type { Machine } from '@entities/machine';
import { getDateFnsLocale } from '@shared/i18n';
import { cn } from '@shared/lib/cn';
import { Calendar } from '@shared/ui/calendar/Calendar';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { format } from 'date-fns';
import { CalendarIcon, Cpu } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchableSelect, useSelectMenu } from './SearchableSelect';

type Props = {
    date: Date | undefined;
    isDateDisabled: boolean;
    dateChanged: boolean;
    machineId: string;
    machines: Machine[];
    onDateChange: (d: Date | undefined) => void;
    onMachineSelect: (id: string) => void;
};

export const BatchFormHeader = ({
    date,
    isDateDisabled,
    dateChanged,
    machineId,
    machines,
    onDateChange,
    onMachineSelect,
}: Props) => {
    const { t } = useTranslation();
    const dateMenu = useSelectMenu('date');
    const [ownCalendarOpen, setOwnCalendarOpen] = useState(false);
    const calendarOpen = dateMenu?.open ?? ownCalendarOpen;
    const setCalendarOpen = (open: boolean) => {
        if (dateMenu) dateMenu.onOpenChange(open);
        else setOwnCalendarOpen(open);
    };

    return (
        <div className="grid grid-cols-2 gap-4">
            <div>
                <label className={labelCls}>
                    <CalendarIcon size={12} /> {t('addBatchModal.date')}
                </label>
                <Popover
                    open={calendarOpen}
                    onOpenChange={(open) => {
                        if (!isDateDisabled) setCalendarOpen(open);
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
                                setCalendarOpen(false);
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
                    menuId="machine"
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
