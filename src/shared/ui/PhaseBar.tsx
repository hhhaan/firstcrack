import type { PhaseSegment } from '@features/active-roast/lib/phases';
import { useEffect, useState } from 'react';

interface PhaseBarProps {
    segments: PhaseSegment[];
    animated?: boolean;
    className?: string;
}

export const PhaseBar = ({ segments, animated = true, className }: PhaseBarProps) => {
    const [ready, setReady] = useState(!animated);

    useEffect(() => {
        if (!animated) return;
        const t = setTimeout(() => setReady(true), 50);
        return () => clearTimeout(t);
    }, [animated, segments]);

    if (segments.length === 0) return null;

    return (
        <div className={className}>
            <div
                className="flex rounded-lg overflow-hidden h-10"
                style={{ background: 'var(--color-border-subtle)' }}
            >
                {segments.map((seg, i) => {
                    const showLabel = seg.pct >= 15;
                    return (
                        <div
                            key={seg.name}
                            className="relative flex items-center justify-center overflow-hidden text-nowrap"
                            style={{
                                width: `${seg.pct}%`,
                                background: seg.color,
                                transform: animated ? (ready ? 'scaleX(1)' : 'scaleX(0)') : undefined,
                                transition: animated
                                    ? `transform 500ms ease-out ${i * 100}ms`
                                    : undefined,
                                transformOrigin: 'left',
                            }}
                        >
                            {showLabel && (
                                <span
                                    className="text-[11px] z-10"
                                    style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)' }}
                                >
                                    {seg.name}
                                    <span className="ml-1" style={{ color: 'var(--color-muted)' }}>
                                        {Math.floor(seg.durationSec / 60)}:{String(seg.durationSec % 60).padStart(2, '0')} {seg.pct}%
                                    </span>
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
