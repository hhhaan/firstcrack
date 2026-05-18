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
                month_caption: 'grid grid-cols-[28px_1fr_28px] items-center h-8',
                caption_label: 'col-start-2 text-center text-[13px] font-semibold text-primary',
                nav: 'contents',
                button_previous:
                    'col-start-1 w-7 h-7 rounded-lg bg-surface border-none cursor-pointer flex items-center justify-center text-muted hover:text-primary shadow-(--shadow-inset) transition-colors',
                button_next:
                    'col-start-3 w-7 h-7 rounded-lg bg-surface border-none cursor-pointer flex items-center justify-center text-muted hover:text-primary shadow-(--shadow-inset) transition-colors',
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
                    '[&>button]:bg-primary [&>button]:text-white [&>button]:hover:bg-primary [&>button]:hover:text-white',
                outside: '[&>button]:text-muted [&>button]:opacity-40',
                disabled: '[&>button]:opacity-25 [&>button]:cursor-not-allowed',
                hidden: 'invisible',
                range_start: '[&>button]:bg-primary [&>button]:text-white [&>button]:rounded-r-none',
                range_middle: '[&>button]:bg-surface [&>button]:rounded-none',
                range_end: '[&>button]:bg-primary [&>button]:text-white [&>button]:rounded-l-none',
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
