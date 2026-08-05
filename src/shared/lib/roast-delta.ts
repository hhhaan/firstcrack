import type { StoredRoastEvent } from '@shared/types/roast';

export interface SessionDevMetrics {
    /** FC Start → Drop (canonical DTR). */
    devTimeSec: number | null;
    devPct: number | null;
    /** FC Rolling → Drop (only when FC Start is also present — orphan Rolling is meaningless). */
    rollingDevTimeSec: number | null;
    rollingDevPct: number | null;
}

const devFromAnchor = (
    anchorSec: number | undefined,
    end: number | null,
    total: number | null,
): { devTimeSec: number | null; devPct: number | null } => {
    if (anchorSec == null || end == null || end <= anchorSec) return { devTimeSec: null, devPct: null };
    const devTimeSec = end - anchorSec;
    const t = total ?? end;
    return { devTimeSec, devPct: t > 0 ? (devTimeSec / t) * 100 : null };
};

/** 세션 행에는 dev 필드가 없어 events에서 파생: FC Start/Rolling → Drop(없으면 duration). */
export const deriveSessionDevMetrics = (events: StoredRoastEvent[], durationSec: number | null): SessionDevMetrics => {
    const end = events.find((e) => e.type === 'Drop')?.time_sec ?? durationSec;
    const total = durationSec ?? end;
    const fcStartSec = events.find((e) => e.type === 'FC Start')?.time_sec;
    const start = devFromAnchor(fcStartSec, end, total);
    // 고아 Rolling(FC Start 삭제됨)은 기준점이 없어 지표를 내지 않는다
    const rolling = devFromAnchor(
        fcStartSec == null ? undefined : events.find((e) => e.type === 'FC Rolling')?.time_sec,
        end,
        total,
    );
    return {
        devTimeSec: start.devTimeSec,
        devPct: start.devPct,
        rollingDevTimeSec: rolling.devTimeSec,
        rollingDevPct: rolling.devPct,
    };
};

/** 양쪽 값이 있을 때만 actual − target. */
export const deltaOrNull = (actual: number | null | undefined, target: number | null | undefined): number | null =>
    actual != null && target != null ? actual - target : null;
