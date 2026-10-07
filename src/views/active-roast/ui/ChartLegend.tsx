import { CurveSwatch, useCurveStyles } from '@features/active-roast';

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
    const curves = useCurveStyles();
    const items = [
        { style: curves.bt.current, label: 'BT' },
        ...(showET ? [{ style: curves.et.current, label: 'ET' }] : []),
        ...(showRoR ? [{ style: curves.ror.current, label: 'RoR' }] : []),
        ...(showRoRET ? [{ style: curves.etRor.current, label: 'ET RoR' }] : []),
        ...(showTarget ? [{ style: curves.bt.background, label: targetLabel }] : []),
    ];

    return (
        <div className="absolute top-[-18px] right-6 z-10 flex items-center gap-4">
            {items.map(({ style, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                    <CurveSwatch style={style} />
                    <span className="text-[11px] text-muted tracking-[0.14px]">{label}</span>
                </div>
            ))}
        </div>
    );
};
