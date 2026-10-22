import { useActiveWorkspace } from '@entities/organization';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { PageHeader } from '@shared/ui/PageHeader';
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
        <div className="flex items-center gap-1 rounded-full bg-surface-elevated p-1">
            {(['day', 'week', 'month'] as ViewMode[]).map((v) => {
                const label = t(`schedule.viewToggle.${v}`);
                return (
                    <button
                        key={v}
                        type="button"
                        onClick={() => onChange(v)}
                        aria-pressed={view === v}
                        className={`cursor-pointer rounded-full border-none px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                            view === v
                                ? 'bg-main-bg text-action shadow-selected dark:bg-surface'
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
        <div className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col overflow-hidden px-6 py-8 sm:px-8">
            <PageHeader title={t('schedule.title')} actions={<ViewToggle view={view} onChange={setView} />} />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-main-bg">
                <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-divider px-6 py-4">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => handleNav(-1)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface dark:bg-surface-elevated text-muted cursor-pointer hover:text-primary transition-colors"
                        >
                            <ChevronLeft size={14} strokeWidth={2} />
                        </button>
                        <span className="text-[13px] font-semibold text-primary min-w-[160px] text-center">
                            {navLabel}
                        </span>
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
                </div>

                {view === 'day' && (
                    <ScheduleDayView selectedDate={selectedDate} userId={userId} onStartBatch={onStartBatch} />
                )}
                {view === 'week' && (
                    <WeekView selectedDate={selectedDate} userId={userId} onSelectDay={handleSelectDay} />
                )}
                {view === 'month' && (
                    <MonthView selectedDate={selectedDate} userId={userId} onSelectDay={handleSelectDay} />
                )}
            </div>
        </div>
    );
};
