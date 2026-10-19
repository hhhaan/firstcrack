import { useRoastingStore } from '@features/active-roast';
import { useWeather } from '@shared/api/weather';
import type { View } from '@shared/types/view';
import { PillButton } from '@shared/ui/PillButton';
import { ArrowRight, CalendarDays, Droplets, Thermometer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getGreeting, localeForDate } from '../lib/format';

interface DashboardHeaderProps {
    onNavigate: (view: View) => void;
}

export const DashboardHeader = ({ onNavigate }: DashboardHeaderProps) => {
    const isRoasting = useRoastingStore((s) => s.phase === 'roasting');
    const weather = useWeather();
    const { t } = useTranslation();

    return (
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4" data-testid="dashboard-header">
            <div>
                <h1
                    data-testid="dashboard-greeting"
                    className="mb-2 font-(--font-display) text-2xl font-medium leading-8 tracking-[0.24px] text-primary"
                >
                    {t('sidebar.nav.dashboard')}
                </h1>
                <p className="flex flex-wrap items-center gap-2 text-xs font-normal text-muted">
                    {t(`dashboard.greeting.${getGreeting()}`)}
                    <span aria-hidden="true">·</span>
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
                <span className="inline-flex items-center gap-2 rounded-full bg-surface-elevated px-3 py-2 text-xs text-secondary">
                    <CalendarDays size={13} strokeWidth={1.5} />
                    {t('dashboard.thisMonth')}
                </span>
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
