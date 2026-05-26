import { useMemo } from 'react';
import { interpolateProfileBT } from '@shared/data/roast-profiles';
import type { TsvPoint } from '@shared/lib/tsv';
import type { LiveRoastPoint } from './useSidecarPolling';

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
    const targetSamples = useMemo(
        () =>
            targetCurvePoints.map((p) => ({
                time: p.t,
                btActual: null as number | null,
                etActual: null as number | null,
                rorActual: null as number | null,
                etRorActual: null as number | null,
                btTarget: p.bt,
            })),
        [targetCurvePoints],
    );

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

        const seen = new Set<number>();
        const deduped: ReturnType<typeof sentinel>[] = [];
        for (const p of live) {
            const key = Math.round(p.time * 100);
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(p);
            }
        }
        for (const p of targetSamples) {
            const key = Math.round(p.time * 100);
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(p);
            }
        }
        deduped.sort((a, b) => a.time - b.time);

        const xMin = -preChargeDisplaySec;
        const needsStart = deduped.length === 0 || deduped[0].time > xMin + 0.5;
        const needsEnd = deduped.length === 0 || deduped[deduped.length - 1].time < CHART_TOTAL_SECS - 1;
        return [
            ...(needsStart ? [sentinel(xMin)] : []),
            ...deduped,
            ...(needsEnd ? [sentinel(CHART_TOTAL_SECS)] : []),
        ];
    }, [livePoints, targetCurvePoints, targetSamples, preChargeDisplaySec]);

    return { chartData };
};
