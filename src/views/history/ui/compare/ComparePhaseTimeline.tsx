import { CHART_GRID_LEFT } from '@features/active-roast/lib/chart-config';
import { formatElapsed } from '@shared/lib/format';
import { useTranslation } from 'react-i18next';
import type { CompareSessionItem } from './CompareSessionTable';

interface ComparePhaseTimelineProps {
    items: CompareSessionItem[];
    xView: { start: number; end: number };
    rightMargin: number;
}

const PHASE_FILL: Record<string, string> = {
    Drying: 'bg-(--color-phase-drying-fill)',
    Maillard: 'bg-(--color-phase-maillard-fill)',
    Development: 'bg-(--color-phase-development-fill)',
};

export const ComparePhaseTimeline = ({ items, xView, rightMargin }: ComparePhaseTimelineProps) => {
    const { t } = useTranslation();
    return (
        <div
            role="group"
            className="space-y-1 pb-5"
            aria-label={t('history.compare.phases')}
            style={{ paddingLeft: CHART_GRID_LEFT, paddingRight: rightMargin }}
        >
            {items.map((item, index) => {
                if (!item.visible) return null;
                const total = item.metrics.roastDurationSec ?? 0;
                return (
                    <div key={item.session.id} className="relative h-6">
                        <span
                            className="absolute right-full mr-2 font-mono text-xs leading-6"
                            style={{ color: item.color }}
                        >
                            {String(index + 1).padStart(2, '0')}
                        </span>
                        {item.segments.map((segment) => {
                            const start = Math.max(xView.start, segment.startSec);
                            const end = Math.min(xView.end, segment.endSec);
                            if (end <= start || total <= 0) return null;
                            const pct = (segment.durationSec / total) * 100;
                            const width = ((end - start) / (xView.end - xView.start)) * 100;
                            const label = `${t(`history.compare.phase${segment.name}`)} · ${formatElapsed(segment.durationSec)} · ${pct.toFixed(1)}%`;
                            return (
                                <div
                                    key={segment.name}
                                    className={`absolute inset-y-0 flex items-center justify-end overflow-hidden border-r border-r-main-bg ${PHASE_FILL[segment.name] ?? 'bg-surface'}`}
                                    style={{
                                        left: `${((start - xView.start) / (xView.end - xView.start)) * 100}%`,
                                        width: `${width}%`,
                                    }}
                                    title={label}
                                >
                                    <span className="sr-only">{label}</span>
                                    {width >= 12 && (
                                        <span aria-hidden="true" className="px-2 font-mono text-xs text-primary">
                                            {pct.toFixed(1)}%
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
};
