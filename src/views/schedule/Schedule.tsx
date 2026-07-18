import { useActiveWorkspace } from '@entities/organization';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useScheduleNav } from './hooks/useScheduleNav';
import type { ViewMode } from './lib';
import { MonthView } from './MonthView';
import { ScheduleDayView } from './ScheduleDayView';
import { WeekView } from './WeekView';

const ViewToggle = ({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) => {
    const { t } = useTranslation();
    return (
        <div className="flex items-center gap-0.5 bg-surface dark:border dark:border-[#585d61] rounded-lg p-0.5">
            {(['day', 'week', 'month'] as ViewMode[]).map((v) => {
                const label = t(`schedule.viewToggle.${v}`);
                return (
                    <button
                        key={v}
                        type="button"
                        onClick={() => onChange(v)}
                        className={`text-[12px] font-medium px-3 py-1 rounded-md border-none cursor-pointer transition-colors duration-150 ${
                            view === v
                                ? 'bg-main-bg dark:bg-surface-elevated text-primary'
                                : 'bg-transparent text-muted hover:text-secondary'
                        }`}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
};

interface ScheduleProps {
    onStartBatch: (handoff: PlanBatchHandoff) => void;
}

export const Schedule = ({ onStartBatch }: ScheduleProps) => {
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { view, setView, selectedDate, handleSelectDay, handleNav, navLabel, isTodaySelected, goToday } =
        useScheduleNav();
    const { t } = useTranslation();

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="shrink-0 border-b border-border-subtle dark:border-[#585d61] bg-main-bg px-6 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => handleNav(-1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface dark:bg-surface-elevated text-muted cursor-pointer hover:text-primary transition-colors"
                    >
                        <ChevronLeft size={14} strokeWidth={2} />
                    </button>
                    <span className="text-[13px] font-semibold text-primary min-w-[160px] text-center">{navLabel}</span>
                    <button
                        type="button"
                        onClick={() => handleNav(1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface dark:bg-surface-elevated text-muted cursor-pointer hover:text-primary transition-colors"
                    >
                        <ChevronRight size={14} strokeWidth={2} />
                    </button>
                    {!isTodaySelected && (
                        <button
                            type="button"
                            onClick={goToday}
                            className="text-[11px] font-medium text-muted rounded-md px-2 py-0.5 bg-surface dark:bg-surface-elevated cursor-pointer hover:text-primary transition-colors"
                        >
                            {t('schedule.today')}
                        </button>
                    )}
                </div>
                <ViewToggle view={view} onChange={setView} />
            </div>

            {view === 'day' && (
                <ScheduleDayView selectedDate={selectedDate} userId={userId} onStartBatch={onStartBatch} />
            )}
            {view === 'week' && <WeekView selectedDate={selectedDate} userId={userId} onSelectDay={handleSelectDay} />}
            {view === 'month' && (
                <MonthView selectedDate={selectedDate} userId={userId} onSelectDay={handleSelectDay} />
            )}
        </div>
    );
};
