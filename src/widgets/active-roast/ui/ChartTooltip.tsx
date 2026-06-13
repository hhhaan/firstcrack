interface ChartTooltipProps {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
    label?: string;
}

export const ChartTooltip = ({ active, payload, label }: ChartTooltipProps) => {
    if (!active || !payload?.length) return null;
    return (
        <div
            style={{
                background: 'white',
                border: 'none',
                padding: '10px 14px',
                boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
                fontSize: 12,
                fontFamily: 'var(--font-body)',
            }}
        >
            <div style={{ fontWeight: 500, color: 'var(--color-muted)', marginBottom: 6, letterSpacing: '0.14px' }}>
                {label}
            </div>
            {payload.map((entry) => (
                <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ width: 8, height: 8, background: entry.color, flexShrink: 0 }} />
                    <span style={{ color: 'var(--color-secondary)' }}>{entry.name}:</span>
                    <span style={{ fontWeight: 600, color: 'var(--color-primary)', fontFamily: 'var(--font-mono)' }}>
                        {entry.name === 'ROR' ? `${entry.value}°/min` : `${entry.value}°C`}
                    </span>
                </div>
            ))}
        </div>
    );
};
