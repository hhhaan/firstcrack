const LEGEND_ITEMS: { color: string; label: string; dashed?: boolean }[] = [
    { color: '#0acc19', label: 'BT' },
    { color: '#2563eb', label: 'ET' },
    { color: '#FFC107', label: 'RoR' },
    { color: 'rgba(16,185,129,0.7)', label: 'Target', dashed: true },
];

export const ChartLegend = () => (
    <div className="absolute top-1 right-10 z-10 flex items-center gap-4">
        {LEGEND_ITEMS.map(({ color, label, dashed }) => (
            <div key={label} className="flex items-center gap-1.5">
                <div
                    style={{
                        width: 16,
                        height: 2,
                        borderRadius: 1,
                        background: dashed
                            ? `repeating-linear-gradient(to right, ${color} 0, ${color} 4px, transparent 4px, transparent 7px)`
                            : color,
                        opacity: dashed ? 0.6 : 1,
                    }}
                />
                <span className="text-[11px] text-muted tracking-[0.14px]">{label}</span>
            </div>
        ))}
    </div>
);
