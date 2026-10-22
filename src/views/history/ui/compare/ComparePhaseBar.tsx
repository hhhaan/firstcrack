import type { PhaseSegment } from '@features/active-roast';
import { formatElapsed } from '@shared/lib/format';
import { useTranslation } from 'react-i18next';

interface ComparePhaseBarProps {
    segments: PhaseSegment[];
    totalSec: number;
    /** Visible time window. Segments outside it are clipped so the bar stays on the chart scale. */
    window: { start: number; end: number };
}

const PHASE_FILL: Record<string, string> = {
    Drying: 'bg-(--color-phase-drying-fill)',
    Maillard: 'bg-(--color-phase-maillard-fill)',
    Development: 'bg-(--color-phase-development-fill)',
};

export const ComparePhaseBar = ({ segments, totalSec, window }: ComparePhaseBarProps) => {
    const { t } = useTranslation();
    if (segments.length === 0 || totalSec <= 0) return <span className="text-muted">—</span>;
    const span = Math.max(1, window.end - window.start);
    const bars = [];
    let cursor = 0;
    for (const segment of segments) {
        const start = cursor;
        const end = cursor + segment.durationSec;
        cursor = end;
        const visibleStart = Math.max(start, window.start);
        const visibleEnd = Math.min(end, window.end);
        if (visibleEnd <= visibleStart) continue;
        const pct = (segment.durationSec / totalSec) * 100;
        const label = `${t(`history.compare.phase${segment.name}`)} · ${formatElapsed(segment.durationSec)} · ${pct.toFixed(1)}%`;
        const width = ((visibleEnd - visibleStart) / span) * 100;
        bars.push(
            <div
                key={segment.name}
                className={`absolute top-0 flex h-full min-w-0 items-center justify-center overflow-hidden ${PHASE_FILL[segment.name] ?? 'bg-surface'}`}
                style={{
                    left: `${((visibleStart - window.start) / span) * 100}%`,
                    width: `${width}%`,
                }}
                title={label}
            >
                <span className="sr-only">{label}</span>
                {width >= 18 && (
                    <span aria-hidden="true" className="truncate px-1 font-mono text-[11px] font-medium text-secondary">
                        {formatElapsed(segment.durationSec)} · {pct.toFixed(1)}%
                    </span>
                )}
            </div>,
        );
    }

    return <div className="relative h-6 w-full overflow-hidden">{bars}</div>;
};
