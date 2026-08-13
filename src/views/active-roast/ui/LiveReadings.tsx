import { formatTemp, type TemperatureUnit, useBbpTimer } from '@features/active-roast';
import { SENSOR_COLORS } from '@features/active-roast/lib/colors';
import { readingFreshness } from '@features/active-roast/lib/readingFreshness';
import { useTranslation } from 'react-i18next';

export const LiveReadings = ({
    rawBT,
    rawET,
    displayRoR,
    unit,
    phase,
    phaseColor,
    connected,
    stale = false,
    reconnecting = false,
}: {
    rawBT: number | null;
    rawET: number | null;
    displayRoR: string;
    unit: TemperatureUnit;
    phase: string;
    phaseColor: string;
    connected: boolean;
    stale?: boolean;
    reconnecting?: boolean;
}) => {
    const { t } = useTranslation();
    const bbpTimer = useBbpTimer();
    const freshness = readingFreshness({ connected, stale, reconnecting });
    const live = freshness === 'live';
    return (
        <div className="mb-2.5">
            {freshness === 'stale' || freshness === 'reconnecting' ? (
                <p className="mb-2 text-[12px] font-medium text-amber-700 dark:text-amber-300">
                    {freshness === 'reconnecting'
                        ? t('activeRoast.readings.reconnecting')
                        : t('activeRoast.readings.stale')}
                </p>
            ) : null}
            <div className="grid grid-cols-4 gap-3">
                {[
                    {
                        label: t('activeRoast.readings.beanTemp'),
                        value: freshness === 'disconnected' ? '—' : formatTemp(rawBT, unit),
                        color: live ? SENSOR_COLORS.bt : 'var(--color-muted)',
                        sub: null as string | null,
                    },
                    {
                        label: t('activeRoast.readings.envTemp'),
                        value: freshness === 'disconnected' ? '—' : formatTemp(rawET, unit),
                        color: live ? SENSOR_COLORS.et : 'var(--color-muted)',
                        sub: null as string | null,
                    },
                    {
                        label: t('activeRoast.readings.rateOfRise'),
                        value: freshness === 'disconnected' ? '—' : `${displayRoR}°${unit}/min`,
                        color: live ? SENSOR_COLORS.ror : 'var(--color-muted)',
                        sub: null as string | null,
                    },
                    {
                        label: t('activeRoast.readings.phase'),
                        value: freshness === 'disconnected' ? '—' : phase,
                        color: live ? phaseColor : 'var(--color-muted)',
                        sub: live && bbpTimer ? `BBP ${bbpTimer}` : null,
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
