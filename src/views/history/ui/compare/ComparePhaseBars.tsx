import type { PhaseSegment } from '@features/active-roast';
import { formatElapsed } from '@shared/lib/format';

export type PhaseBarRow = {
    id: string;
    color: string;
    label: string;
    segments: PhaseSegment[];
    totalSec: number;
    visible?: boolean;
};

interface ComparePhaseBarsProps {
    rows: PhaseBarRow[];
    maxSec: number;
}

const PHASE_SOFT: Record<string, string> = {
    Drying: 'color-mix(in srgb, var(--color-phase-drying) 28%, transparent)',
    Maillard: 'color-mix(in srgb, var(--color-phase-maillard) 28%, transparent)',
    Development: 'color-mix(in srgb, var(--color-phase-development) 28%, transparent)',
};

export const ComparePhaseBars = ({ rows, maxSec }: ComparePhaseBarsProps) => {
    const visible = rows.filter((r) => r.visible !== false && r.segments.length > 0 && r.totalSec > 0);
    if (visible.length === 0 || maxSec <= 0) return null;

    return (
        <div className="flex flex-col gap-1.5">
            {visible.map((row) => {
                const widthPct = Math.min(100, (row.totalSec / maxSec) * 100);
                return (
                    <div key={row.id} className="flex items-center gap-2.5">
                        <div
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: row.color }}
                            title={row.label}
                        />
                        <div className="relative h-6 min-w-0 flex-1">
                            <div
                                className="absolute inset-y-0 left-0 flex overflow-hidden rounded-sm"
                                style={{ width: `${widthPct}%` }}
                            >
                                {row.segments.map((seg) => {
                                    const pct = (seg.durationSec / row.totalSec) * 100;
                                    if (pct <= 0) return null;
                                    const showLabel = pct >= 12;
                                    const pctLabel = pct.toFixed(1);
                                    return (
                                        <div
                                            key={`${row.id}-${seg.name}`}
                                            className="flex h-full min-w-0 items-center justify-center overflow-hidden border-r border-white/50 last:border-r-0 dark:border-black/20"
                                            style={{
                                                width: `${pct}%`,
                                                background: PHASE_SOFT[seg.name] ?? seg.color,
                                            }}
                                            title={`${seg.name} · ${formatElapsed(seg.durationSec)} · ${pctLabel}%`}
                                        >
                                            {showLabel && (
                                                <span className="truncate px-1 font-mono text-[10px] font-semibold tracking-[-0.1px] text-primary/80 tabular-nums">
                                                    {formatElapsed(seg.durationSec)} {pctLabel}%
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
