import { PHASE_COLORS } from '@features/active-roast/lib/colors';
import { logEntryTimeSec } from '@features/active-roast/lib/serialize-roast-events';
import type { LogEntry } from '@shared/types/roast';

/** First batch: Roast Ready. After Drop/abort: already hot — wait for Charge. */
export const waitPhaseAfterRoastReset = (chargeWait: boolean): 'standby' | 'preheating' =>
    chargeWait ? 'standby' : 'preheating';

/**
 * 이벤트 로그 기반으로 현재 로스팅 단계 이름을 결정한다.
 */
export const getRoastPhaseName = (
    charged: boolean,
    phase: string,
    elapsed: number,
    logEntries: LogEntry[],
    bbpActive = false,
): string => {
    // Unsaved ended is not the next-batch wait. Post-drop standby uses the same READY label.
    if (phase === 'ended') return 'ENDED';
    if (bbpActive) return 'READY';
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
    if (fcStartEntry && elapsed >= logEntryTimeSec(fcStartEntry)) return 'Development';
    if (yellowEntry && elapsed >= logEntryTimeSec(yellowEntry)) return 'Maillard';
    return 'Drying';
};

export const getRoastPhaseColor = (charged: boolean, phaseName: string): string => {
    if (!charged || phaseName === 'READY') return PHASE_COLORS.ready;
    switch (phaseName) {
        case 'ENDED':
        case 'Development':
            return PHASE_COLORS.development;
        case 'Maillard':
            return PHASE_COLORS.maillard;
        default:
            return PHASE_COLORS.drying;
    }
};
