import { useRoastingStore } from '@features/active-roast';
import { useWeather } from '@shared/api/weather';
import type { View } from '@shared/types/view';
import { PillButton } from '@shared/ui/PillButton';
import { addMonths, isSameMonth, startOfMonth } from 'date-fns';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Droplets, Thermometer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getGreeting, localeForDate } from '../lib/format';
import { canGoToNextDashboardMonth, canGoToPreviousDashboardMonth } from '../lib/month';

interface DashboardHeaderProps {
    month: Date;
    onMonthChange: (month: Date) => void;
    onNavigate: (view: View) => void;
}

const monthButtonClass =
    'grid size-8 place-items-center rounded-full text-secondary transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong-border disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent';

export const DashboardHeader = ({ month, onMonthChange, onNavigate }: DashboardHeaderProps) => {
    const isRoasting = useRoastingStore((s) => s.phase === 'roasting');
    const weather = useWeather();
    const { t } = useTranslation();
    const now = new Date();
    const current = isSameMonth(month, now);
    const label = current
        ? t('dashboard.thisMonth')
        : month.toLocaleDateString(localeForDate(), { month: 'short', year: 'numeric' });

    return (
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4" data-testid="dashboard-header">
            <div>
                <h1
                    data-testid="dashboard-greeting"
                    className="mb-2 font-(--font-display) text-4xl font-normal leading-10 tracking-[0.24px] text-primary"
                >
                    {t(`dashboard.greeting.${getGreeting()}`)}
                </h1>
                <p className="flex flex-wrap items-center gap-2 text-xs font-normal text-muted">
                    {new Date().toLocaleDateString(localeForDate(), {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                    })}
                    {weather.data && (
                        <>
                            <span className="text-muted/40">·</span>
                            <span className="flex items-center gap-1 text-muted">
                                <Thermometer size={13} strokeWidth={1.5} />
                                {weather.data.temperature}°C
                            </span>
                            <span className="flex items-center gap-1 text-muted">
                                <Droplets size={13} strokeWidth={1.5} />
                                {weather.data.humidity}%
                            </span>
                        </>
                    )}
                </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <div
                    className="inline-flex h-8 items-center rounded-full bg-surface-elevated pl-1 pr-1 text-xs text-secondary"
                    data-testid="dashboard-month"
                >
                    <button
                        type="button"
                        className={monthButtonClass}
                        aria-label={t('dashboard.previousMonth')}
                        disabled={!canGoToPreviousDashboardMonth(month, now)}
                        onClick={() => onMonthChange(addMonths(startOfMonth(month), -1))}
                    >
                        <ChevronLeft size={14} strokeWidth={1.75} />
                    </button>
                    <span className="inline-flex items-center gap-1.5 px-1" data-testid="dashboard-month-label">
                        <CalendarDays size={13} strokeWidth={1.5} />
                        {label}
                    </span>
                    <button
                        type="button"
                        className={monthButtonClass}
                        aria-label={t('dashboard.nextMonth')}
                        disabled={!canGoToNextDashboardMonth(month, now)}
                        onClick={() => onMonthChange(addMonths(startOfMonth(month), 1))}
                    >
                        <ChevronRight size={14} strokeWidth={1.75} />
                    </button>
                </div>
                <PillButton onClick={() => onNavigate('roast')}>
                    <span
                        className={`w-1.75 h-1.75 rounded-full inline-block ${isRoasting ? 'bg-palette-green animate-pulse' : 'bg-current opacity-40'}`}
                    />
                    {t('dashboard.viewActiveRoast')}
                    <ArrowRight size={14} strokeWidth={2} />
                </PillButton>
            </div>
        </div>
    );
};
