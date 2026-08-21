import { useProfileConsistency } from '@entities/roast-profile';
import { formatTemp, tempUnitLabel, toDisplayTempDelta, useRoastSettings } from '@features/active-roast';
import { formatDuration } from '@shared/lib/format';
import { Badge } from '@shared/ui/Badge';
import { Sparkline } from '@shared/ui/Sparkline';
import { AlertCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { computeConsistencyStats, MIN_CONSISTENCY_SESSIONS } from '../lib/consistency';

export const ConsistencyCard = ({ profileId }: { profileId: string }) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const metricFormats: Record<string, { value: (v: number) => string; sd: (v: number) => string }> = {
        dropTemp: {
            value: (v) => formatTemp(v, unit),
            sd: (v) => `±${toDisplayTempDelta(v, unit).toFixed(1)}${tempUnitLabel(unit)}`,
        },
        duration: { value: (v) => formatDuration(Math.round(v)), sd: (v) => `±${Math.round(v)}s` },
        weight: { value: (v) => `${Math.round(v)}g`, sd: (v) => `±${Math.round(v)}g` },
    };
    const { data: rows = [] } = useProfileConsistency(profileId);
    const metrics = useMemo(() => computeConsistencyStats(rows), [rows]);

    if (rows.length === 0) return null;

    const labelKey: Record<string, string> = {
        dropTemp: 'profiles.detail.dropTemp',
        duration: 'profiles.detail.duration',
        weight: 'history.table.weight',
    };
    const dropTemp = metrics.find((m) => m.key === 'dropTemp');
    const totalOutliers = metrics.reduce((acc, m) => acc + m.outlierCount, 0);

    return (
        <div className="bg-surface dark:bg-surface-elevated rounded-lg px-4 py-3 mb-5">
            <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase">
                    {t('profiles.detail.consistency.title', { count: rows.length })}
                </p>
                {totalOutliers > 0 && (
                    <Badge size="sm" tone="yellow" icon={<AlertCircle size={10} strokeWidth={2} />}>
                        {t('profiles.detail.consistency.outliers', { count: totalOutliers })}
                    </Badge>
                )}
            </div>

            {rows.length < MIN_CONSISTENCY_SESSIONS ? (
                <p className="text-xs text-muted py-1">
                    {t('profiles.detail.consistency.notEnough', { min: MIN_CONSISTENCY_SESSIONS })}
                </p>
            ) : (
                <>
                    {dropTemp && dropTemp.values.length >= 2 && (
                        <div className="mb-2">
                            <Sparkline
                                data={dropTemp.values.map((v) => ({ bt: v }))}
                                color="var(--color-palette-green)"
                            />
                        </div>
                    )}
                    <div className="grid grid-cols-3 gap-3">
                        {metrics.map((m) => (
                            <div key={m.key}>
                                <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-1">
                                    {t(labelKey[m.key])}
                                </div>
                                <div className="text-sm font-semibold text-primary font-mono tracking-[-0.2px]">
                                    {m.mean != null ? metricFormats[m.key].value(m.mean) : '—'}
                                </div>
                                <div className="text-[11px] text-muted font-mono">
                                    {m.sd != null ? metricFormats[m.key].sd(m.sd) : '—'} · n={m.n}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};
