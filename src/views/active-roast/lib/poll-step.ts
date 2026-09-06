import { formatElapsed } from '@shared/lib/format';
import { formatTsvRow } from '@shared/lib/tsv-writer';

/** 폴링 중 누적하는 실시간 측정 포인트 */
export interface LiveRoastPoint {
    time: number;
    label: string;
    bt: number;
    et: number | null;
    ror: number | null;
    ror_et: number | null;
    /** null = 화력 피드백 채널 없음 — TSV에는 빈칸으로 남는다 */
    heater: number | null;
    fan: number;
    drum: number;
}

export type PreChargeSample = Omit<LiveRoastPoint, 'time' | 'label'> & { absTime: number };

export type PollReading = {
    bt: number;
    et: number | null;
    ror: number | null;
    ror_et: number | null;
    heater: number | null;
    fan: number;
    drum: number;
};

export type PollSessionState = {
    phase: string;
    nowMs: number;
    roastStartMs: number;
    sessionId: string | null;
    lastRoastPointTime: number | null;
    lastStandbyAbsTime: number | null;
    preChargeStartMs: number;
};

export type PollStepResult = {
    bbp?: PollReading;
    elapsedSec?: number;
    lastRoastPointTime?: number;
    lastStandbyAbsTime?: number;
    preChargeStartMs?: number;
    bufferPush?: PreChargeSample;
    livePoint?: LiveRoastPoint;
    tsvRow?: string;
};

const ROAST_DEDUPE_S = 0.4;
const STANDBY_DEDUPE_MS = 400;
const PRE_CHARGE_BUFFER_MAX = 1200;

/** Charge lookback 샘플 라벨. relSec < 0일 때만 마이너스 접두. */
export function formatLookbackLabel(relSec: number): string {
    const body = formatElapsed(Math.abs(relSec));
    return relSec < 0 ? `-${body}` : body;
}

const pointFields = (reading: PollReading): Omit<LiveRoastPoint, 'time' | 'label'> => ({
    bt: reading.bt,
    et: reading.et,
    ror: reading.ror,
    ror_et: reading.ror_et,
    heater: reading.heater,
    fan: reading.fan,
    drum: reading.drum,
});

/** phase → roasting: buffer samples become negative-time live points. */
export function convertPreChargeBuffer(
    buffer: readonly PreChargeSample[],
    chargeTimeMs: number,
    preChargeDisplaySec: number,
): LiveRoastPoint[] {
    if (chargeTimeMs === 0 || buffer.length === 0) return [];
    const cutoff = chargeTimeMs - preChargeDisplaySec * 1000;
    return buffer
        .filter((p) => p.absTime >= cutoff)
        .map((p) => {
            const relSec = (p.absTime - chargeTimeMs) / 1000;
            return { ...p, time: relSec, label: formatLookbackLabel(relSec) };
        });
}

/**
 * One accepted (non-null, non-glitch) poll tick.
 * Caller applies store / TSV / livePoints; this owns order, dedupe, and TSV shape.
 */
export function stepPoll(reading: PollReading, session: PollSessionState): PollStepResult {
    const fields = pointFields(reading);
    const result: PollStepResult = {};

    if (session.phase !== 'roasting') {
        result.bbp = fields;
    }

    if (session.phase === 'roasting' && session.roastStartMs !== 0) {
        const t = (session.nowMs - session.roastStartMs) / 1000;
        result.elapsedSec = Math.floor(t);
        const last = session.lastRoastPointTime;
        if (last !== null && t >= last && t - last < ROAST_DEDUPE_S) {
            return result;
        }
        result.lastRoastPointTime = t;
        result.livePoint = { time: t, label: formatElapsed(t), ...fields };
        if (session.sessionId) {
            result.tsvRow = formatTsvRow({
                time: t,
                bt: reading.bt,
                et: reading.et,
                ror: reading.ror,
                heater: reading.heater,
                fan: reading.fan,
                drum: reading.drum,
            });
        }
        return result;
    }

    if (session.phase === 'standby') {
        const lastAbs = session.lastStandbyAbsTime;
        if (lastAbs !== null && session.nowMs - lastAbs < STANDBY_DEDUPE_MS) {
            return result;
        }
        let start = session.preChargeStartMs;
        if (start === 0) {
            start = session.nowMs;
            result.preChargeStartMs = start;
        }
        result.lastStandbyAbsTime = session.nowMs;
        result.bufferPush = { absTime: session.nowMs, ...fields };
        const sessionTime = (session.nowMs - start) / 1000;
        result.livePoint = { time: sessionTime, label: formatElapsed(sessionTime), ...fields };
    }

    return result;
}

export const trimPreChargeBuffer = (buf: PreChargeSample[]): void => {
    if (buf.length > PRE_CHARGE_BUFFER_MAX) buf.splice(0, buf.length - PRE_CHARGE_BUFFER_MAX);
};
