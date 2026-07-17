import type { StoredRoastEvent } from '@shared/types/roast';

export interface SessionDevMetrics {
    devTimeSec: number | null;
    devPct: number | null;
}

/** 세션 행에는 dev 필드가 없어 events에서 파생: FC Start → Drop(없으면 duration). */
export const deriveSessionDevMetrics = (events: StoredRoastEvent[], durationSec: number | null): SessionDevMetrics => {
    const fcStart = events.find((e) => e.type === 'FC Start')?.time_sec;
    const end = events.find((e) => e.type === 'Drop')?.time_sec ?? durationSec;
    if (fcStart == null || end == null || end <= fcStart) return { devTimeSec: null, devPct: null };
    const devTimeSec = end - fcStart;
    const total = durationSec ?? end;
    return { devTimeSec, devPct: total > 0 ? (devTimeSec / total) * 100 : null };
};

/** 양쪽 값이 있을 때만 actual − target. */
export const deltaOrNull = (actual: number | null | undefined, target: number | null | undefined): number | null =>
    actual != null && target != null ? actual - target : null;
