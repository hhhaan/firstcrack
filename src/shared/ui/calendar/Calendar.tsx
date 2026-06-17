import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { cn } from '@shared/lib/cn';

export type CalendarProps = DayPickerProps;

export const Calendar = ({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) => {
    return (
        <DayPicker
            showOutsideDays={showOutsideDays}
            className={cn('p-3', className)}
            classNames={{
                months: 'flex flex-col',
                month: 'space-y-3',

                month_caption: 'relative flex items-center justify-center h-8 px-1',
                caption_label: 'text-[13px] font-semibold text-primary',
                nav: 'absolute inset-x-0 flex items-center justify-between pt-1 px-8 z-10',
                button_previous:
                    'w-6 h-6 rounded-md bg-surface border-none cursor-pointer flex items-center justify-center text-muted hover:text-primary shadow-(--shadow-inset) transition-colors',
                button_next:
                    'w-6 h-6 rounded-md bg-surface border-none cursor-pointer flex items-center justify-center text-muted hover:text-primary shadow-(--shadow-inset) transition-colors',
                month_grid: 'w-full border-collapse',
                weekdays: 'flex',
                weekday: 'w-9 text-[11px] font-medium text-muted text-center py-1',
                weeks: 'space-y-0.5 mt-1',
                week: 'flex',
                day: 'w-9 h-9 p-0 text-center relative',
                day_button:
                    'w-9 h-9 rounded-lg text-[13px] font-medium text-secondary border-none bg-transparent cursor-pointer transition-colors hover:bg-surface hover:text-primary',
                today: '[&>button]:text-primary [&>button]:font-semibold',
                selected:
                    '[&>button]:bg-primary [&>button]:text-white dark:[&>button]:text-[#181d21] [&>button]:hover:bg-primary [&>button]:hover:text-white dark:[&>button]:hover:text-[#181d21]',
                outside: '[&>button]:text-muted [&>button]:opacity-40',
                disabled: '[&>button]:opacity-25 [&>button]:cursor-not-allowed',
                hidden: 'invisible',
                ...classNames,
            }}
            components={{
                Chevron: ({ orientation }) =>
                    orientation === 'left' ? (
                        <ChevronLeft size={14} strokeWidth={2} />
                    ) : (
                        <ChevronRight size={14} strokeWidth={2} />
                    ),
            }}
            {...props}
        />
    );
};
