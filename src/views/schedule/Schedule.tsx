import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuthStore } from '@shared/store/auth';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import type { ViewMode } from './lib';
import { useScheduleNav } from './hooks/useScheduleNav';
import { ScheduleDayView } from './ScheduleDayView';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';

const ViewToggle = ({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) => (
    <div className="flex items-center gap-0.5 bg-surface rounded-lg p-0.5">
        {(['day', 'week', 'month'] as ViewMode[]).map((v) => {
            const label = v === 'day' ? '일' : v === 'week' ? '주' : '월';
            return (
                <button
                    key={v}
                    onClick={() => onChange(v)}
                    className={`text-[12px] font-medium px-3 py-1 rounded-md border-none cursor-pointer transition-colors duration-150 ${
                        view === v
                            ? 'bg-main-bg text-primary'
                            : 'bg-transparent text-muted hover:text-secondary'
                    }`}
                >
                    {label}
                </button>
            );
        })}
    </div>
);

interface ScheduleProps {
    onStartBatch: (handoff: PlanBatchHandoff) => void;
}

export const Schedule = ({ onStartBatch }: ScheduleProps) => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { view, setView, selectedDate, handleSelectDay, handleNav, navLabel, isTodaySelected, goToday } = useScheduleNav();

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="shrink-0 border-b border-border-subtle bg-main-bg px-6 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => handleNav(-1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface text-muted cursor-pointer hover:text-primary transition-colors"
                    >
                        <ChevronLeft size={14} strokeWidth={2} />
                    </button>
                    <span className="text-[13px] font-semibold text-primary min-w-[160px] text-center">
                        {navLabel}
                    </span>
                    <button
                        onClick={() => handleNav(1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface text-muted cursor-pointer hover:text-primary transition-colors"
                    >
                        <ChevronRight size={14} strokeWidth={2} />
                    </button>
                    {!isTodaySelected && (
                        <button
                            onClick={goToday}
                            className="text-[11px] font-medium text-muted rounded-md px-2 py-0.5 bg-surface cursor-pointer hover:text-primary transition-colors"
                        >
                            오늘
                        </button>
                    )}
                </div>
                <ViewToggle view={view} onChange={setView} />
            </div>

            {view === 'day' && (
                <ScheduleDayView
                    selectedDate={selectedDate}
                    userId={userId}
                    onStartBatch={onStartBatch}
                />
            )}
            {view === 'week' && (
                <WeekView
                    selectedDate={selectedDate}
                    userId={userId}
                    onSelectDay={handleSelectDay}
                />
            )}
            {view === 'month' && (
                <MonthView
                    selectedDate={selectedDate}
                    userId={userId}
                    onSelectDay={handleSelectDay}
                />
            )}
        </div>
    );
};