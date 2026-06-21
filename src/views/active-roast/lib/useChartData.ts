import { interpolateProfileBT } from '@shared/data/roast-profiles';
import type { TsvPoint } from '@shared/lib/tsv';
import { useMemo } from 'react';
import type { LiveRoastPoint } from '../model/useSidecarPolling';

/** 차트 전체 x축 범위(초). uPlot에 항상 이 길이를 보장한다. */
export const CHART_TOTAL_SECS = 780;

export const useChartData = ({
    livePoints,
    targetCurvePoints,
    preChargeDisplaySec,
}: {
    livePoints: LiveRoastPoint[];
    /** 타깃 프로파일의 실제 저장 데이터. 없으면 빈 배열. */
    targetCurvePoints: TsvPoint[];
    preChargeDisplaySec: number;
}) => {
    const chartData = useMemo(() => {
        const hasTarget = targetCurvePoints.length > 0;
        const sentinel = (t: number) => ({
            time: t,
            btActual: null as number | null,
            etActual: null as number | null,
            rorActual: null as number | null,
            etRorActual: null as number | null,
            btTarget: hasTarget ? interpolateProfileBT(targetCurvePoints, t) : null,
        });

        const live = livePoints.map((p) => ({
            time: p.time,
            btActual: p.bt,
            etActual: p.et,
            rorActual: p.ror,
            etRorActual: p.ror_et,
            btTarget: hasTarget ? interpolateProfileBT(targetCurvePoints, p.time) : null,
        }));

        // 타깃 프로파일 knot(30s 간격)을 btActual:null로 합치면 live 폴링 시각과
        // 겹치지 않아 ECharts 선이 30초마다 끊긴다. btTarget은 live 시각에서 보간한다.
        const seen = new Set<number>();
        const deduped: ReturnType<typeof sentinel>[] = [];
        for (const p of live) {
            const key = Math.round(p.time * 100);
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(p);
            }
        }
        deduped.sort((a, b) => a.time - b.time);

        const xMin = -preChargeDisplaySec;
        const profileDuration = targetCurvePoints.length > 0 ? targetCurvePoints[targetCurvePoints.length - 1].t : 0;
        const liveMax = livePoints.length > 0 ? livePoints[livePoints.length - 1].time : 0;
        const chartTotalSecs = Math.max(CHART_TOTAL_SECS, profileDuration, liveMax);
        const needsStart = deduped.length === 0 || deduped[0].time > xMin + 0.5;
        const needsEnd = deduped.length === 0 || deduped[deduped.length - 1].time < chartTotalSecs - 1;
        return [...(needsStart ? [sentinel(xMin)] : []), ...deduped, ...(needsEnd ? [sentinel(chartTotalSecs)] : [])];
    }, [livePoints, targetCurvePoints, preChargeDisplaySec]);

    /** 타깃 프로파일 전체 곡선 — BT Actual과 분리해 렌더링 (null actual 구멍 방지) */
    const targetSeries = useMemo(
        () =>
            targetCurvePoints.map((p) => ({
                time: p.t,
                bt: p.bt,
            })),
        [targetCurvePoints],
    );

    return { chartData, targetSeries };
};
