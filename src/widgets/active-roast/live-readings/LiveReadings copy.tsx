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
    <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
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
                <div
                    key={label}
                    style={{
                        background: 'var(--color-main-bg)',
                        borderRadius: 8,
                        padding: '14px 18px',
                        boxShadow: 'var(--shadow-ring)',
                    }}
                >
                    <span
                        style={{
                            display: 'block',
                            fontSize: 11,
                            color: 'var(--color-muted)',
                            fontWeight: 600,
                            letterSpacing: '0.7px',
                            textTransform: 'uppercase',
                            marginBottom: 8,
                        }}
                    >
                        {label}
                    </span>
                    <div
                        style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 22,
                            fontWeight: 700,
                            color: color,
                            letterSpacing: '-0.5px',
                        }}
                    >
                        {value}
                    </div>
                </div>
            ))}
        </div>
    </div>
);
