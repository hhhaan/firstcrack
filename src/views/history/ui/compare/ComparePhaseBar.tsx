import type { PhaseSegment } from '@features/active-roast';
import { formatElapsed } from '@shared/lib/format';
import { useTranslation } from 'react-i18next';

interface ComparePhaseBarProps {
    segments: PhaseSegment[];
    totalSec: number;
    maxSec: number;
}

const PHASE_FILL: Record<string, string> = {
    Drying: 'bg-(--color-phase-drying-fill) border-(--color-phase-drying)',
    Maillard: 'bg-(--color-phase-maillard-fill) border-(--color-phase-maillard)',
    Development: 'bg-(--color-phase-development-fill) border-(--color-phase-development)',
};

export const ComparePhaseBar = ({ segments, totalSec, maxSec }: ComparePhaseBarProps) => {
    const { t } = useTranslation();
    if (segments.length === 0 || totalSec <= 0) return <span className="text-muted">—</span>;

    return (
        <div
            className="flex h-7 overflow-hidden rounded"
            style={{ width: `${Math.min(100, (totalSec / maxSec) * 100)}%` }}
        >
            {segments.map((segment) => {
                const pct = (segment.durationSec / totalSec) * 100;
                if (pct <= 0) return null;
                const label = `${t(`history.compare.phase${segment.name}`)} · ${formatElapsed(segment.durationSec)} · ${pct.toFixed(1)}%`;
                return (
                    <div
                        key={segment.name}
                        className={`flex min-w-0 items-center justify-center overflow-hidden border-b-2 border-r border-r-main-bg last:border-r-0 ${PHASE_FILL[segment.name] ?? 'bg-surface border-border'}`}
                        style={{ width: `${pct}%` }}
                        title={label}
                    >
                        <span className="sr-only">{label}</span>
                        {pct >= 18 && (
                            <span aria-hidden="true" className="truncate px-1 font-mono text-[10px] text-secondary">
                                {formatElapsed(segment.durationSec)}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
