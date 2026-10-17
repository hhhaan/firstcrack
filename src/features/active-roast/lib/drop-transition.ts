import { formatElapsed } from '@shared/lib/format';
import { deriveRoastMetrics } from '@shared/lib/roast-delta';
import type { LogEntry } from '@shared/types/roast';
import type { ExtraSensorReading, TemperatureProcessing } from '@shared/types/sidecar';
import type { BbpPoint } from '../model/bbp';
import type { TemperatureUnit } from '../model/settings';
import { logEntryTimeSec } from './serialize-roast-events';
import { formatTemp } from './temperature';

/** Charge-relative curve sample used to split roast vs BBP at Drop. */
export type DropCurvePoint = {
    time: number;
    bt: number;
    et: number | null;
    heater: number | null;
    fan: number;
    drum: number;
    etRaw?: number | null;
    btRaw?: number | null;
    ror_et?: number | null;
    sensorTimestamp?: number | null;
    sensorClock?: string | null;
    processing?: TemperatureProcessing;
    extraReadings?: ExtraSensorReading[];
};

export type DropOnset = { timeSec: number; bt: number };

export type DropSummary = {
    totalTime: string;
    development: string;
    finalBt: string;
    logEntries: LogEntry[];
    sessionId: string;
    elapsedSec: number;
};

export type DropTransitionInput = {
    sessionId: string | null;
    charged: boolean;
    phase: string;
    roastStartMs: number;
    elapsed: number;
    rawBT: number | null;
    unit: TemperatureUnit;
    logEntries: LogEntry[];
    livePoints: DropCurvePoint[];
    onset?: DropOnset;
    /** Idempotency: this session already completed Drop. */
    droppedSessionId: string | null;
};

export type DropTransitionResult = {
    sessionId: string;
    dropTimeSec: number;
    dropBt: number | null;
    bbpStartMs: number;
    roastPoints: DropCurvePoint[];
    bbpSeed: BbpPoint[];
    logEntries: LogEntry[];
    summary: DropSummary;
};

export const dropBbpStartMs = (roastStartMs: number, dropTimeSec: number): number =>
    roastStartMs + Math.max(0, dropTimeSec) * 1000;

export const foldPostDropPointsToBbp = (livePoints: DropCurvePoint[], dropTimeSec: number): BbpPoint[] =>
    livePoints
        .filter((p) => Number.isFinite(p.time) && p.time >= dropTimeSec && Number.isFinite(p.bt))
        .map((p) => ({
            t: p.time - dropTimeSec,
            bt: p.bt,
            btRaw: p.btRaw ?? null,
            etRaw: p.etRaw ?? null,
            ror_et: p.ror_et ?? null,
            sensorTimestamp: p.sensorTimestamp ?? null,
            sensorClock: p.sensorClock ?? null,
            processing: p.processing,
            et: p.et,
            heater: p.heater,
            fan: p.fan,
            drum: p.drum,
            extraReadings: p.extraReadings,
        }));

export const clipRoastPointsAtDrop = (livePoints: DropCurvePoint[], dropTimeSec: number): DropCurvePoint[] =>
    livePoints.filter((p) => Number.isFinite(p.time) && p.time <= dropTimeSec);

export const canCancelDrop = (opts: { nextCharged: boolean; submitted: boolean }): boolean =>
    !opts.nextCharged && !opts.submitted;

const ensureDropLog = (
    logEntries: LogEntry[],
    dropTimeSec: number,
    dropBt: number | null,
    unit: TemperatureUnit,
    note: string,
): LogEntry[] => {
    const existing = logEntries.find((e) => e.event === 'Drop');
    if (existing) {
        if (existing.timeSec === dropTimeSec && existing.tempC === dropBt) return logEntries;
        return logEntries
            .map((e) =>
                e.event === 'Drop'
                    ? {
                          ...e,
                          time: formatElapsed(dropTimeSec),
                          timeSec: dropTimeSec,
                          temp: dropBt != null ? formatTemp(dropBt, unit) : e.temp,
                          tempC: dropBt,
                          note: e.note || note,
                      }
                    : e,
            )
            .sort((a, b) => (logEntryTimeSec(a) ?? 0) - (logEntryTimeSec(b) ?? 0));
    }
    const entry: LogEntry = {
        id: crypto.randomUUID(),
        time: formatElapsed(dropTimeSec),
        timeSec: dropTimeSec,
        event: 'Drop',
        temp: dropBt != null ? formatTemp(dropBt, unit) : '',
        tempC: dropBt,
        note,
    };
    return [...logEntries, entry].sort((a, b) => (logEntryTimeSec(a) ?? 0) - (logEntryTimeSec(b) ?? 0));
};

export const buildDropSummary = (
    logEntries: LogEntry[],
    dropTimeSec: number,
    dropBt: number | null,
    unit: TemperatureUnit,
    sessionId: string,
): DropSummary => {
    const metrics = deriveRoastMetrics(
        logEntries.flatMap((e) => {
            const timeSec = logEntryTimeSec(e);
            return timeSec == null ? [] : [{ type: e.event, time_sec: timeSec }];
        }),
        { liveElapsed: dropTimeSec },
    );
    const roastTimeStr =
        metrics.roastDurationSec != null ? formatElapsed(metrics.roastDurationSec) : formatElapsed(dropTimeSec);
    const development =
        metrics.devTimeSec != null && metrics.dtrPct != null && metrics.devTimeSec > 0
            ? `${formatElapsed(metrics.devTimeSec)} (${Number(metrics.dtrPct.toFixed(1))}%)`
            : '—';
    return {
        totalTime: roastTimeStr,
        development,
        finalBt: formatTemp(dropBt, unit),
        logEntries,
        sessionId,
        elapsedSec: dropTimeSec,
    };
};

/** Plan a Drop→end transition. Null when this session cannot Drop (idle / duplicate). */
export const planDropTransition = (input: DropTransitionInput): DropTransitionResult | null => {
    const { sessionId, charged, phase, roastStartMs, elapsed, rawBT, unit, logEntries, livePoints, onset } = input;
    if (!sessionId || !charged || phase !== 'roasting') return null;
    if (input.droppedSessionId === sessionId) return null;

    const dropTimeSec = Math.max(0, onset?.timeSec ?? elapsed);
    const dropBt = onset?.bt ?? rawBT;
    const note = onset ? 'Bean drop detected' : 'Coffee dropped';
    const nextLogs = ensureDropLog(logEntries, dropTimeSec, dropBt, unit, note);
    const summary = buildDropSummary(nextLogs, dropTimeSec, dropBt, unit, sessionId);
    return {
        sessionId,
        dropTimeSec,
        dropBt,
        bbpStartMs: dropBbpStartMs(roastStartMs, dropTimeSec),
        roastPoints: clipRoastPointsAtDrop(livePoints, dropTimeSec),
        bbpSeed: foldPostDropPointsToBbp(livePoints, dropTimeSec),
        logEntries: nextLogs,
        summary,
    };
};
