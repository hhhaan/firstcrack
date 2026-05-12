import { SENSOR_COLORS } from '@features/active-roast/lib/colors';

const LEGEND_ITEMS: { color: string; label: string; dashed?: boolean }[] = [
    { color: SENSOR_COLORS.bt, label: 'BT' },
    { color: SENSOR_COLORS.et, label: 'ET' },
    { color: SENSOR_COLORS.ror, label: 'RoR' },
    { color: SENSOR_COLORS.btTarget, label: 'Target', dashed: true },
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
