import { EVENT_MARKER_COLORS, getResolvedEventColor } from '@features/active-roast/lib/chart-config';
import { formatTemp, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { parseTimeSec } from '@features/active-roast/lib/time';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import type { LogEntry } from '@shared/types/roast';
import type { LiveRoastPoint } from '../model/useSidecarPolling';
import type { RoastEventMarker } from '../ui/RoastTempChart';

export interface DevTimeResult {
    devTimeStr: string;
    dtrPct: number | null;
}

/** Development 시간 및 DTR 비율 계산 */
export const calcDevTime = (fcStartEntry: LogEntry | undefined, elapsed: number): DevTimeResult => {
    if (!fcStartEntry || elapsed === 0) return { devTimeStr: '—', dtrPct: null };
    const devSec = elapsed - parseTimeSec(fcStartEntry.time);
    if (devSec <= 0) return { devTimeStr: '—', dtrPct: null };
    const pct = Math.round((devSec / elapsed) * 100);
    return {
        devTimeStr: `${Math.floor(devSec / 60)}:${String(devSec % 60).padStart(2, '0')} (${pct}%)`,
        dtrPct: pct,
    };
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

/** 이벤트 로그를 ECharts 마커 배열로 변환 */
export const buildEventMarkers = (logEntries: LogEntry[]): RoastEventMarker[] =>
    logEntries
        .filter((e) => EVENT_MARKER_COLORS[e.event] && e.event !== 'TP' && e.event !== 'Note')
        .map((e) => {
            const [min, sec] = e.time.split(':').map(Number);
            const timeSec = Math.max(0, min * 60 + sec);
            return { timeSec, event: e.event, color: getResolvedEventColor(e.event) };
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
    const sorted = [...logEntries].sort((a, b) => parseTimeSec(a.time) - parseTimeSec(b.time));
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
