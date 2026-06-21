import { PHASE_COLORS } from '@features/active-roast/lib/colors';
import { parseTimeSec } from '@features/active-roast/lib/time';
import type { LogEntry } from '@shared/types/roast';

/**
 * 이벤트 로그 기반으로 현재 로스팅 단계 이름을 결정한다.
 */
export const getRoastPhaseName = (charged: boolean, phase: string, elapsed: number, logEntries: LogEntry[]): string => {
    if (!charged) {
        switch (phase) {
            case 'standby':
                return 'READY';
            case 'preheating':
                return 'PREHEATING';
            case 'idle':
                return 'IDLE';
            default:
                return phase;
        }
    }
    const fcStartEntry = logEntries.find((e) => e.event === 'FC Start');
    const yellowEntry = logEntries.find((e) => e.event === 'Yellow');
    if (fcStartEntry && elapsed >= parseTimeSec(fcStartEntry.time)) return 'Development';
    if (yellowEntry && elapsed >= parseTimeSec(yellowEntry.time)) return 'Maillard';
    return 'Drying';
};

export const getRoastPhaseColor = (charged: boolean, phaseName: string): string => {
    if (!charged) return PHASE_COLORS.ready;
    switch (phaseName) {
        case 'Development':
            return PHASE_COLORS.development;
        case 'Maillard':
            return PHASE_COLORS.maillard;
        default:
            return PHASE_COLORS.drying;
    }
};
