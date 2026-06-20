import type { BlendSegmentSource } from '@entities/blend/lib';

export const BLEND_SEGMENT_COLORS = [
    'var(--color-palette-blue)',
    'var(--color-palette-teal)',
    'var(--color-palette-purple)',
    'var(--color-palette-lavender)',
    'var(--color-palette-green)',
    'var(--color-palette-yellow)',
] as const;

export type BlendCompositionSegment = {
    ratioPct: number;
    color: string;
    label?: string;
    id?: string;
};

export const coloredSegmentsFromSources = (sources: BlendSegmentSource[]): BlendCompositionSegment[] =>
    sources.map((source, i) => ({
        ...source,
        color: BLEND_SEGMENT_COLORS[i % BLEND_SEGMENT_COLORS.length],
    }));

const truncateLabel = (label: string, max = 12) => (label.length > max ? `${label.slice(0, max)}…` : label);

export const BlendCompositionBar = ({
    segments,
    height = 'sm',
    showLegend = false,
}: {
    segments: BlendCompositionSegment[];
    height?: 'sm' | 'md';
    showLegend?: boolean;
}) => {
    const total = segments.reduce((sum, s) => sum + s.ratioPct, 0);
    const barHeight = height === 'md' ? 'h-1.5' : 'h-1';

    return (
        <div>
            <div className={`${barHeight} flex rounded-full overflow-hidden bg-surface dark:bg-white/8`}>
                {segments.map((seg) => (
                    <div
                        key={seg.id ?? `${seg.label}-${seg.ratioPct}`}
                        className="h-full transition-all"
                        style={{
                            width: total > 0 ? `${(seg.ratioPct / total) * 100}%` : '0%',
                            backgroundColor: seg.color,
                        }}
                    />
                ))}
            </div>
            {showLegend && segments.length > 0 && (
                <p className="text-[11px] text-muted tracking-[0.14px] mt-1.5 truncate">
                    {segments.map((seg) => `${truncateLabel(seg.label ?? '')} ${seg.ratioPct}%`).join(' · ')}
                </p>
            )}
        </div>
    );
};
