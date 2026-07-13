import type { LogEntry } from '@shared/types/roast';
import { logEntryTimeSec } from './serialize-roast-events';

export interface PhaseSegment {
    name: string;
    startSec: number;
    endSec: number;
    durationSec: number;
    pct: number;
    color: string;
}

/** CSS phase fill tokens — resolved at call time for light/dark theme support. */
const PHASE_FILL_CSS_VARS: Record<string, { varName: string; fallback: string }> = {
    Drying: { varName: '--color-phase-drying-fill', fallback: 'rgba(231,174,0,0.26)' },
    Maillard: { varName: '--color-phase-maillard-fill', fallback: 'rgba(0,145,203,0.26)' },
    Development: { varName: '--color-phase-development-fill', fallback: 'rgba(105,103,225,0.26)' },
};

const resolvePhaseFill = (name: string): string => {
    const entry = PHASE_FILL_CSS_VARS[name];
    if (!entry) return 'rgba(0,0,0,0.1)';
    if (typeof document === 'undefined') return entry.fallback;
    const val = getComputedStyle(document.documentElement).getPropertyValue(entry.varName).trim();
    return val || entry.fallback;
};

/**
 * logEntries + elapsed로 현재까지의 위상 구간 배열을 반환한다.
 * charged(Charge 이후)가 아니면 빈 배열.
 */
export const computePhaseSegments = (logEntries: LogEntry[], elapsed: number, charged: boolean): PhaseSegment[] => {
    if (!charged || elapsed === 0) return [];

    const get = (event: string) => {
        const e = logEntries.find((l) => l.event === event);
        return e ? logEntryTimeSec(e) : null;
    };

    const yellow = get('Yellow');
    const fcStart = get('FC Start');
    const dropTime = get('Drop') ?? get('End') ?? elapsed;

    const bounds: { name: string; start: number | null; end: number }[] = [
        { name: 'Drying', start: 0, end: yellow ?? fcStart ?? dropTime },
        { name: 'Maillard', start: yellow, end: fcStart ?? dropTime },
        { name: 'Development', start: fcStart, end: dropTime },
    ];

    return bounds
        .filter((b): b is { name: string; start: number; end: number } => b.start != null && b.end > b.start)
        .map((b) => {
            const end = Math.min(b.end, elapsed);
            const dur = end - b.start;
            return {
                name: b.name,
                startSec: b.start,
                endSec: end,
                durationSec: dur,
                pct: Math.round((dur / elapsed) * 100),
                color: resolvePhaseFill(b.name),
            };
        });
};
