import { cn } from '@shared/lib/cn';
import { type SavedSensorPoint, savedSensorChannels } from '../lib/saved-chart-presentation';
import type { RoastSettings } from '../model/settings';
import { useCurveStyles } from '../model/useCurveStyles';
import { CurveSwatch } from './CurveSwatch';

export function SavedCurveLegend({
    points,
    settings,
    showTarget = false,
    profileName = '',
    className,
}: {
    points: readonly SavedSensorPoint[];
    settings: RoastSettings;
    showTarget?: boolean;
    profileName?: string;
    className?: string;
}) {
    const curves = useCurveStyles();
    return (
        <div
            className={cn(
                'flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] font-medium text-secondary',
                className,
            )}
        >
            {savedSensorChannels(points, settings).map((channel) => (
                <span key={channel.key} className="inline-flex items-center gap-2">
                    <CurveSwatch style={curves[channel.key].current} />
                    {channel.label}
                </span>
            ))}
            {showTarget && (
                <span className="inline-flex min-w-0 items-center gap-2 text-muted">
                    <CurveSwatch style={curves.bt.background} />
                    {profileName}
                </span>
            )}
        </div>
    );
}
