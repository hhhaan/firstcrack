import { getResolvedEventColor, isChartEventMarker } from '@features/active-roast/lib/chart-config';
import type { RoastEventMarker } from '@features/active-roast/lib/chart-option';
import { logEntryTimeSec } from '@features/active-roast/lib/serialize-roast-events';
import { formatTemp, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { interpolateProfileBT } from '@shared/data/roast-profiles';
import type { LogEntry } from '@shared/types/roast';
import type { LiveRoastPoint } from '../model/useSidecarPolling';

export interface DevTimeResult {
    /** "m:ss (n%)" — 요약 모달용 (DTR을 따로 안 보여주는 곳) */
    devTimeStr: string;
    /** "m:ss" — DTR을 옆에 이미 표시하는 사이드패널용 */
    devTimeOnly: string;
    dtrPct: number | null;
}

const EMPTY_DEV: DevTimeResult = { devTimeStr: '—', devTimeOnly: '—', dtrPct: null };

/** Development 시간 및 DTR 비율 계산 */
export const calcDevTime = (fcStartEntry: LogEntry | undefined, elapsed: number): DevTimeResult => {
    if (!fcStartEntry || elapsed === 0) return EMPTY_DEV;
    const devSec = elapsed - logEntryTimeSec(fcStartEntry);
    if (devSec <= 0) return EMPTY_DEV;
    const pct = Math.round((devSec / elapsed) * 100);
    const mmss = `${Math.floor(devSec / 60)}:${String(devSec % 60).padStart(2, '0')}`;
    return { devTimeStr: `${mmss} (${pct}%)`, devTimeOnly: mmss, dtrPct: pct };
};

export interface DeltaResult {
    deltaBT: string | null;
    deltaET: string | null;
}

/** ΔBT, ΔET — 30초 전 대비 현재 온도 변화량 (pre-charge 포인트 제외) */
export const calcDelta = (livePoints: LiveRoastPoint[], unit: TemperatureUnit): DeltaResult => {
    const postChargePoints = livePoints.filter((p) => p.time >= 0);
    if (postChargePoints.length < 2) return { deltaBT: null, deltaET: null };
    const current = postChargePoints[postChargePoints.length - 1];
    const targetTime = current.time - 30;
    const past = postChargePoints.reduce((prev, curr) =>
        Math.abs(curr.time - targetTime) < Math.abs(prev.time - targetTime) ? curr : prev,
    );
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

/** 이벤트 로그를 ECharts 마커 배열로 변환 */
export const buildEventMarkers = (logEntries: LogEntry[]): RoastEventMarker[] =>
    logEntries
        .filter((e) => isChartEventMarker(e.event))
        .map((e) => {
            const timeSec = Math.max(0, logEntryTimeSec(e));
            return { timeSec, event: e.event, color: getResolvedEventColor(e.event), timeStr: e.time, temp: e.temp };
        });

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
    const sorted = [...logEntries].sort((a, b) => logEntryTimeSec(a) - logEntryTimeSec(b));
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
