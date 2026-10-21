import { getResolvedEventColor, isChartEventMarker } from '@features/active-roast/lib/chart-config';
import type { RoastEventMarker } from '@features/active-roast/lib/chart-option';
import { fanDrumMarkersFromLog } from '@features/active-roast/lib/fan-drum-markers';
import { omitRepeatHeaterMarks } from '@features/active-roast/lib/repeat-heater';
import { logEntryTimeSec } from '@features/active-roast/lib/serialize-roast-events';
import { formatTemp, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { interpolateProfileBT } from '@shared/data/roast-profiles';
import { formatElapsed } from '@shared/lib/format';
import { deriveRoastMetrics } from '@shared/lib/roast-delta';
import type { LogEntry } from '@shared/types/roast';
import type { LiveRoastPoint } from '../model/useSidecarPolling';

export interface DevTimeResult {
    /** "m:ss (n%)" — 요약 모달용 (DTR을 따로 안 보여주는 곳) */
    devTimeStr: string;
    /** "m:ss" — DTR을 옆에 이미 표시하는 사이드패널용 */
    devTimeOnly: string;
    dtrPct: number | null;
    roastDurationSec: number | null;
    rollingDevTimeOnly: string;
    rollingDtrPct: number | null;
}

const formatDevParts = (
    devTimeSec: number | null,
    dtrPct: number | null,
): Pick<DevTimeResult, 'devTimeStr' | 'devTimeOnly' | 'dtrPct'> => {
    if (devTimeSec == null || dtrPct == null || devTimeSec <= 0) {
        return { devTimeStr: '—', devTimeOnly: '—', dtrPct: null };
    }
    const mmss = formatElapsed(devTimeSec);
    const pct = Number(dtrPct.toFixed(1));
    return { devTimeStr: `${mmss} (${pct}%)`, devTimeOnly: mmss, dtrPct: pct };
};

/** Live roast metrics — same Drop-first calc as History / profile. Display rounding only. */
export const calcDevTime = (logEntries: LogEntry[], elapsed: number): DevTimeResult => {
    const metrics = deriveRoastMetrics(
        logEntries
            .filter((e) => !e.current && e.event !== 'Now')
            .flatMap((e) => {
                const timeSec = logEntryTimeSec(e);
                return timeSec == null ? [] : [{ type: e.event, time_sec: timeSec }];
            }),
        { liveElapsed: elapsed },
    );
    const start = formatDevParts(metrics.devTimeSec, metrics.dtrPct);
    const rolling = formatDevParts(metrics.rollingDevTimeSec, metrics.rollingDevPct);
    return {
        ...start,
        roastDurationSec: metrics.roastDurationSec,
        rollingDevTimeOnly: rolling.devTimeOnly,
        rollingDtrPct: rolling.dtrPct,
    };
};

export interface DeltaResult {
    deltaBT: string | null;
    deltaET: string | null;
}

/** ΔBT, ΔET — 30초 전 대비 현재 온도 변화량 (pre-charge 포인트 제외) */
export const calcDelta = (livePoints: LiveRoastPoint[], unit: TemperatureUnit): DeltaResult => {
    // allocation-free backward walk; no early exit — livePoints can have rare
    // out-of-order appends (see chart-pipeline-data.ts) and a full scan is cheap
    let currentIdx = -1;
    for (let i = livePoints.length - 1; i >= 0; i--) {
        if (livePoints[i].time >= 0) {
            currentIdx = i;
            break;
        }
    }
    if (currentIdx < 1) return { deltaBT: null, deltaET: null };

    const current = livePoints[currentIdx];
    const targetTime = current.time - 30;
    let past = current;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = currentIdx; i >= 0; i--) {
        const p = livePoints[i];
        if (p.time < 0) continue;
        const dist = Math.abs(p.time - targetTime);
        if (dist < bestDist) {
            bestDist = dist;
            past = p;
        }
    }
    if (past === current) return { deltaBT: null, deltaET: null };
    const dbt = toDisplayTemp(current.bt, unit) - toDisplayTemp(past.bt, unit);
    const det =
        current.et != null && past.et != null ? toDisplayTemp(current.et, unit) - toDisplayTemp(past.et, unit) : null;
    return {
        deltaBT: dbt.toFixed(1),
        deltaET: det != null ? det.toFixed(1) : null,
    };
};

export type TargetDeltaStatus = 'within' | 'over' | 'under';

export interface TargetDeltaResult {
    /** 표시 단위(°C/°F) 기준 delta */
    deltaDisplay: number;
    status: TargetDeltaStatus;
}

// ponytail: 밴드 ±2°C 하드코드 — 설정화(RoastSettings)는 수요 생기면
const TARGET_DELTA_BAND_C = 2;

/** 현재 BT − 타겟 곡선 BT(현재 시각 선형 보간). 타겟 곡선/BT 없으면 null. */
export const calcTargetDelta = (
    rawBT: number | null,
    targetCurvePoints: { t: number; bt: number }[],
    elapsedSec: number,
    unit: TemperatureUnit,
): TargetDeltaResult | null => {
    if (rawBT == null || targetCurvePoints.length === 0) return null;
    const targetBt = interpolateProfileBT(targetCurvePoints, elapsedSec);
    if (targetBt == null) return null;
    const deltaC = rawBT - targetBt;
    const status: TargetDeltaStatus =
        Math.abs(deltaC) <= TARGET_DELTA_BAND_C ? 'within' : deltaC > 0 ? 'over' : 'under';
    return { deltaDisplay: toDisplayTemp(rawBT, unit) - toDisplayTemp(targetBt, unit), status };
};

/** 이벤트 로그를 ECharts 마커 배열로 변환. 같은 화력을 다시 누른 표시는 뺀다. */
export const buildEventMarkers = (logEntries: LogEntry[]): RoastEventMarker[] => [
    ...omitRepeatHeaterMarks(
        logEntries
            .filter((e) => isChartEventMarker(e.event))
            .flatMap((e) => {
                const entryTimeSec = logEntryTimeSec(e);
                if (entryTimeSec == null) return [];
                const timeSec = Math.max(0, entryTimeSec);
                return [
                    {
                        logId: e.id,
                        timeSec,
                        event: e.event,
                        color: getResolvedEventColor(e.event),
                        timeStr: e.time,
                        temp: e.temp,
                        tempC: e.tempC,
                        note: e.note,
                        ...(e.gas ? { gas: e.gas } : {}),
                        ...(e.airflow ? { airflow: e.airflow } : {}),
                        ...(e.drum ? { drum: e.drum } : {}),
                    },
                ];
            }),
    ),
    ...fanDrumMarkersFromLog(logEntries),
];

export interface RoastLogDisplayEntry extends LogEntry {
    current?: boolean;
}

/** 로그 표시용 엔트리 배열 (현재 진행 중 표시 + 정렬) */
export const buildRoastLogDisplayEntries = (
    logEntries: LogEntry[],
    roastEnded: boolean,
    charged: boolean,
    timeStr: string,
    rawBT: number | null,
    roastPhaseName: string,
    unit: TemperatureUnit,
): RoastLogDisplayEntry[] => {
    const sorted = logEntries
        .filter((e) => e.event !== 'Control')
        .sort((a, b) => (logEntryTimeSec(a) ?? 0) - (logEntryTimeSec(b) ?? 0));
    return [
        ...sorted,
        ...(!roastEnded && charged
            ? [
                  {
                      time: timeStr,
                      event: 'Now',
                      temp: formatTemp(rawBT, unit),
                      note: `${roastPhaseName} in progress`,
                      current: true,
                  },
              ]
            : []),
    ];
};
