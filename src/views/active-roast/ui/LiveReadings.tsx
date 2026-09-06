import { formatTemp, type TemperatureUnit, useBbpTimer } from '@features/active-roast';
import { SENSOR_COLORS } from '@features/active-roast/lib/colors';
import { roastPhaseLabel } from '@features/active-roast/lib/roast-i18n';
import { useTranslation } from 'react-i18next';

export const LiveReadings = ({
    rawBT,
    rawET,
    displayRoR,
    unit,
    phase,
    phaseColor,
    connected,
}: {
    rawBT: number | null;
    rawET: number | null;
    displayRoR: string;
    unit: TemperatureUnit;
    phase: string;
    phaseColor: string;
    connected: boolean;
}) => {
    const { t } = useTranslation();
    const bbpTimer = useBbpTimer();
    return (
        <div className="mb-2.5">
            <div className="grid grid-cols-4 gap-3">
                {[
                    {
                        label: t('activeRoast.readings.beanTemp'),
                        value: connected ? formatTemp(rawBT, unit) : '—',
                        color: connected ? SENSOR_COLORS.bt : 'var(--color-muted)',
                        sub: null as string | null,
                    },
                    {
                        label: t('activeRoast.readings.envTemp'),
                        value: connected ? formatTemp(rawET, unit) : '—',
                        color: connected ? SENSOR_COLORS.et : 'var(--color-muted)',
                        sub: null as string | null,
                    },
                    {
                        label: t('activeRoast.readings.rateOfRise'),
                        value: connected ? `${displayRoR}°${unit}/min` : '—',
                        color: connected ? SENSOR_COLORS.ror : 'var(--color-muted)',
                        sub: null as string | null,
                    },
                    {
                        label: t('activeRoast.readings.phase'),
                        value: connected ? roastPhaseLabel(phase, t) : '—',
                        color: connected ? phaseColor : 'var(--color-muted)',
                        sub: connected && bbpTimer ? `BBP ${bbpTimer}` : null,
                    },
                ].map(({ label, value, color, sub }) => (
                    <div
                        key={label}
                        className="bg-main-bg rounded px-4.5 py-3.5 border border-[#E5E5E5] dark:border-[#585d61]"
                    >
                        <span className="block text-xs text-muted font-medium tracking-[0.7px] uppercase mb-2">
                            {label}
                        </span>
                        <div className="font-mono text-[26px] font-medium tracking-[-0.5px]" style={{ color }}>
                            {value}
                        </div>
                        {sub && <span className="block text-xs text-muted font-mono mt-1 tracking-[0.3px]">{sub}</span>}
                    </div>
                ))}
            </div>
        </div>
    );
};
