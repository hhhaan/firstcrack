import { REFERENCE_CURVE_OPACITY } from '@features/active-roast/lib/chart-config';
import { SENSOR_COLORS } from '@features/active-roast/lib/colors';

export const ChartLegend = ({
    showTarget = false,
    targetLabel = 'Target',
    showET = true,
    showRoR = true,
    showRoRET = false,
}: {
    showTarget?: boolean;
    targetLabel?: string;
    showET?: boolean;
    showRoR?: boolean;
    showRoRET?: boolean;
}) => {
    const items = [
        { color: SENSOR_COLORS.bt, label: 'BT' },
        ...(showET ? [{ color: SENSOR_COLORS.et, label: 'ET' }] : []),
        ...(showRoR ? [{ color: SENSOR_COLORS.ror, label: 'RoR' }] : []),
        ...(showRoRET ? [{ color: SENSOR_COLORS.et, label: 'ET RoR', dashed: true }] : []),
        ...(showTarget
            ? [{ color: 'var(--color-chart-axis-label)', label: targetLabel, opacity: REFERENCE_CURVE_OPACITY }]
            : []),
    ];

    return (
        <div className="absolute top-[-18px] right-6 z-10 flex items-center gap-4">
            {items.map(({ color, label, dashed, opacity }) => (
                <div key={label} className="flex items-center gap-1.5">
                    <div
                        style={{
                            width: 16,
                            height: 2,
                            background: dashed
                                ? `repeating-linear-gradient(to right, ${color} 0, ${color} 4px, transparent 4px, transparent 7px)`
                                : color,
                            opacity: opacity ?? (dashed ? 0.6 : 1),
                        }}
                    />
                    <span className="text-[11px] text-muted tracking-[0.14px]">{label}</span>
                </div>
            ))}
        </div>
    );
};
