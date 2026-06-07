import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns';
import { useMonthSummary } from '@entities/plan';
import { toDateKey } from './lib';
import { DayBatchPreview } from './DayBatchPreview';

export const MonthView = ({
    selectedDate,
    userId,
    onSelectDay,
}: {
    selectedDate: Date;
    userId: string;
    onSelectDay: (d: Date) => void;
}) => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const { data: summaries = [] } = useMonthSummary(userId, year, month);
    const summaryByDate = new Map(summaries.map((s) => [s.date, s]));

    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const numWeeks = days.length / 7;

    const dayHeaders = ['월', '화', '수', '목', '금', '토', '일'];

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border-subtle shrink-0">
                {dayHeaders.map((d, i) => (
                    <div
                        key={d}
                        className={`py-2 text-center text-[11px] font-medium text-muted ${i < 6 ? 'border-r border-border-subtle' : ''}`}
                    >
                        {d}
                    </div>
                ))}
            </div>

            <div
                className="flex-1 grid grid-cols-7 overflow-hidden"
                style={{ gridTemplateRows: `repeat(${numWeeks}, 1fr)` }}
            >
                {days.map((day, idx) => {
                    const key = toDateKey(day);
                    const summary = summaryByDate.get(key);
                    const isCurrentMonth = isSameMonth(day, selectedDate);
                    const isSelected = isSameDay(day, selectedDate);
                    const today = isToday(day);
                    const row = Math.floor(idx / 7);
                    const isLastRow = row === numWeeks - 1;
                    const isLastCol = idx % 7 === 6;
                    const batches = summary?.batches ?? [];

                    return (
                        <button
                            key={key}
                            onClick={() => onSelectDay(day)}
                            className={`
                                flex flex-col gap-1 p-2 border-none cursor-pointer text-left
                                transition-colors duration-100 overflow-hidden
                                ${isSelected ? 'bg-primary/5' : isCurrentMonth ? 'bg-main-bg hover:bg-surface' : 'bg-surface/40 hover:bg-surface'}
                                ${!isLastRow ? 'border-b border-border-subtle' : ''}
                                ${!isLastCol ? 'border-r border-border-subtle' : ''}
                            `}
                        >
                            <div className="flex justify-end">
                                <span className={`
                                    text-[12px] font-medium w-6 h-6 flex items-center justify-center rounded-full leading-none
                                    ${today ? 'bg-primary text-white' : isCurrentMonth ? 'text-primary' : 'text-muted/40'}
                                `}>
                                    {format(day, 'd')}
                                </span>
                            </div>

                            {batches.length > 0 && isCurrentMonth && (
                                <>
                                    <div className="text-[10px] font-semibold text-secondary leading-tight px-0.5 -mt-0.5">
                                        {batches.length}개 배치
                                    </div>
                                    <DayBatchPreview batches={batches} maxLines={2} compact />
                                </>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};