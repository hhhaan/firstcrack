import type { LogEntry } from '@shared/types/roast';
import { parseTimeSec } from './time';

export interface PhaseSegment {
    name: string;
    startSec: number;
    endSec: number;
    durationSec: number;
    pct: number;
    color: string;
}

const PHASE_FILL_COLORS: Record<string, string> = {
    Drying: 'rgba(234,179,8,0.22)',
    Maillard: 'rgba(132,204,22,0.22)',
    Development: 'rgba(249,115,22,0.22)',
};

const PHASE_FALLBACK_COLOR = 'rgba(128,128,128,0.15)';

/**
 * logEntries + elapsed로 현재까지의 위상 구간 배열을 반환한다.
 * charged(Charge 이후)가 아니면 빈 배열.
 * Turning Point가 있으면 Yellow의 fallback 경계로 사용한다.
 */
export const computePhaseSegments = (logEntries: LogEntry[], elapsed: number, charged: boolean): PhaseSegment[] => {
    if (!charged || elapsed === 0) return [];

    const get = (event: string) => {
        const e = logEntries.find((l) => l.event === event);
        return e ? parseTimeSec(e.time) : null;
    };

    const tp = get('Turning Point');
    const yellow = get('Yellow');
    const fcStart = get('FC Start');
    const dropTime = get('Drop') ?? get('End') ?? elapsed;

    // Turning Point가 있으면 Yellow의 fallback으로 사용
    const effectiveYellow = yellow ?? tp ?? null;

    const bounds: { name: string; start: number | null; end: number }[] = [
        { name: 'Drying', start: 0, end: effectiveYellow ?? fcStart ?? dropTime },
        { name: 'Maillard', start: effectiveYellow, end: fcStart ?? dropTime },
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
                color: PHASE_FILL_COLORS[b.name] ?? PHASE_FALLBACK_COLOR,
            };
        });
};
