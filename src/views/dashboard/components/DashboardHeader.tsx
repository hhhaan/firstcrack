import { isVirtualMachineSnapshot } from '@entities/machine';
import { useRoastingStore } from '@features/active-roast';
import { useWeather } from '@shared/api/weather';
import type { View } from '@shared/types/view';
import { PillButton } from '@shared/ui/PillButton';
import { ArrowRight, Droplets, Thermometer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getGreeting, localeForDate } from '../lib/format';

interface DashboardHeaderProps {
    onNavigate: (view: View) => void;
}

export const DashboardHeader = ({ onNavigate }: DashboardHeaderProps) => {
    const isRoasting = useRoastingStore((s) => s.isRoasting && !isVirtualMachineSnapshot(s.machineSnapshot));
    const weather = useWeather();
    const { t } = useTranslation();

    return (
        <div className="mb-8 flex items-end justify-between" data-testid="dashboard-header">
            <div>
                <h1
                    data-testid="dashboard-greeting"
                    className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5"
                >
                    {t(`dashboard.greeting.${getGreeting()}`)}
                </h1>
                <p className="text-[15px] text-secondary tracking-[0.15px] font-normal flex items-center gap-2.5">
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
            <PillButton onClick={() => onNavigate('roast')}>
                <span
                    className={`w-1.75 h-1.75 rounded-full inline-block ${isRoasting ? 'bg-palette-green animate-pulse' : 'bg-white/40'}`}
                />
                {t('dashboard.viewActiveRoast')}
                <ArrowRight size={14} strokeWidth={2} />
            </PillButton>
        </div>
    );
};
