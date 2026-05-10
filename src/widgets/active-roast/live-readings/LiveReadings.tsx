import { Thermometer, Wind, TrendingUp, AlertCircle } from 'lucide-react';
import { formatTemp, type TemperatureUnit } from '@features/active-roast';

export const LiveReadings = ({
    rawBT,
    rawET,
    displayRoR,
    unit,
    phase,
    phaseColor,
}: {
    rawBT: number | null;
    rawET: number | null;
    displayRoR: string;
    unit: TemperatureUnit;
    phase: string;
    phaseColor: string;
}) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 10 }}>
        {[
            {
                label: 'Bean Temp',
                value: formatTemp(rawBT, unit),
                icon: Thermometer,
                color: '#ea580c',
                bg: 'rgba(253,224,178,0.5)',
            },
            {
                label: 'Env Temp',
                value: formatTemp(rawET, unit),
                icon: Wind,
                color: '#2563eb',
                bg: 'rgba(219,234,254,0.5)',
            },
            {
                label: 'Rate of Rise',
                value: `${displayRoR}°${unit}/min`,
                icon: TrendingUp,
                color: '#7c3aed',
                bg: 'rgba(237,233,254,0.5)',
            },
            { label: 'Phase', value: phase, icon: AlertCircle, color: phaseColor, bg: `rgba(253,224,178,0.3)` },
        ].map(({ label, value, icon: Icon, color, bg }) => (
            <div
                key={label}
                style={{
                    background: 'var(--color-main-bg)',
                    borderRadius: 8,
                    padding: '16px 18px',
                    boxShadow: 'var(--shadow-ring)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div
                        style={{
                            width: 28,
                            height: 28,
                            borderRadius: 7,
                            background: bg,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Icon size={14} strokeWidth={2} color={color} />
                    </div>
                    <span
                        style={{
                            fontSize: 12,
                            color: 'var(--color-muted)',
                            fontWeight: 500,
                            letterSpacing: '0.5px',
                            textTransform: 'uppercase',
                        }}
                    >
                        {label}
                    </span>
                </div>
                <div
                    style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 22,
                        fontWeight: 600,
                        color: 'var(--color-primary)',
                        letterSpacing: '-0.5px',
                    }}
                >
                    {value}
                </div>
            </div>
        ))}
    </div>
);
