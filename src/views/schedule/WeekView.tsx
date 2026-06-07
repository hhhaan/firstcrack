import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, isToday } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useWeekSummary } from '@entities/plan';
import type { DayPlanSummary } from '@entities/plan';
import { toDateKey } from './lib';
import { DayBatchPreview } from './DayBatchPreview';

export const WeekView = ({
    selectedDate,
    userId,
    onSelectDay,
}: {
    selectedDate: Date;
    userId: string;
    onSelectDay: (d: Date) => void;
}) => {
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
    const { data: summaries = [] } = useWeekSummary(userId, weekStart);
    const summaryByDate = new Map(summaries.map((s) => [s.date, s]));
    const days = eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) });

    return (
        <div className="flex-1 overflow-hidden px-6 py-4">
            <div className="flex gap-2 h-full">
                {days.map((day) => {
                    const key = toDateKey(day);
                    const summary = summaryByDate.get(key);
                    return (
                        <WeekDayColumn
                            key={key}
                            day={day}
                            summary={summary}
                            isSelected={isSameDay(day, selectedDate)}
                            onSelect={() => onSelectDay(day)}
                        />
                    );
                })}
            </div>
        </div>
    );
};

const WeekDayColumn = ({
    day,
    summary,
    isSelected,
    onSelect,
}: {
    day: Date;
    summary: DayPlanSummary | undefined;
    isSelected: boolean;
    onSelect: () => void;
}) => {
    const today = isToday(day);
    const batches = summary?.batches ?? [];

    return (
        <div
            onClick={onSelect}
            className={`
                flex-1 flex flex-col rounded-xl cursor-pointer transition-colors duration-100
                ${isSelected ? 'bg-primary/5' : 'bg-main-bg'}
            `}
        >
            <div className="px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                    <span className={`
                        text-[11px] font-medium w-5 h-5 flex items-center justify-center rounded-full shrink-0
                        ${today ? 'bg-primary text-white' : 'text-muted'}
                    `}>
                        {format(day, 'd')}
                    </span>
                    <span className="text-[11px] text-muted">{format(day, 'eee', { locale: ko })}</span>
                </div>
            </div>
            <div className="px-2 py-2 flex-1 flex flex-col gap-0.5 overflow-hidden">
                {batches.length === 0 ? (
                    <span className="text-[10px] text-muted/40 select-none px-1">—</span>
                ) : (
                    <>
                        <div className="text-[10px] font-semibold text-secondary leading-tight px-1">
                            {batches.length}개 배치
                        </div>
                        <DayBatchPreview batches={batches} maxLines={3} compact />
                    </>
                )}
            </div>
        </div>
    );
};