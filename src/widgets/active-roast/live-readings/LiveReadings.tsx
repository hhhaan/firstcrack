import { formatTemp, type TemperatureUnit } from '@features/active-roast';
import { SENSOR_COLORS } from '@features/active-roast/lib/colors';

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
}) => (
    <div className="mb-2.5">
        <div className="grid grid-cols-4 gap-3">
            {[
                {
                    label: 'Bean Temp',
                    value: connected ? formatTemp(rawBT, unit) : '—',
                    color: connected ? SENSOR_COLORS.bt : 'var(--color-muted)',
                },
                {
                    label: 'Env Temp',
                    value: connected ? formatTemp(rawET, unit) : '—',
                    color: connected ? SENSOR_COLORS.et : 'var(--color-muted)',
                },
                {
                    label: 'Rate of Rise',
                    value: connected ? `${displayRoR}°${unit}/min` : '—',
                    color: connected ? SENSOR_COLORS.ror : 'var(--color-muted)',
                },
                {
                    label: 'Phase',
                    value: connected ? phase : '—',
                    color: connected ? phaseColor : 'var(--color-muted)',
                },
            ].map(({ label, value, color }) => (
                <div key={label} className="bg-main-bg rounded-lg px-4.5 py-3.5 border border-[#E5E5E5]">
                    <span className="block text-xs text-muted font-medium tracking-[0.7px] uppercase mb-2">
                        {label}
                    </span>
                    <div className="font-mono text-[26px] font-medium tracking-[-0.5px]" style={{ color }}>
                        {value}
                    </div>
                </div>
            ))}
        </div>
    </div>
);
