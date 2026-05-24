import { useMemo } from 'react';
import { generateProfileCurve, interpolateProfileBT } from '@shared/data/roast-profiles';
import type { LiveRoastPoint } from './useSidecarPolling';

/** 차트 전체 x축 범위(초). uPlot에 항상 이 길이를 보장한다. */
export const CHART_TOTAL_SECS = 780;

/**
 * 차트에 그릴 데이터 포인트 배열을 계산한다.
 *
 * 처리 흐름:
 * 1. 선택된 프로파일의 BT 커브를 30초 단위로 샘플링 (targetSamples)
 * 2. 실시간 측정값(livePoints)과 병합·정렬·중복제거
 * 3. x축이 항상 [0, CHART_TOTAL_SECS]를 채우도록 sentinel 포인트를 양 끝에 추가
 *
 * targetSamples는 프로파일이 바뀔 때만 재계산되고, chartData는 livePoints가
 * 추가될 때마다 재계산되므로 두 단계를 분리해 불필요한 연산을 줄인다.
 */
export const useChartData = ({
    livePoints,
    targetProfile,
}: {
    livePoints: LiveRoastPoint[];
    targetProfile: { drop_temp_celsius: number | null; duration_sec: number | null } | null;
}) => {
    const targetCurve = useMemo(() => {
        if (!targetProfile?.drop_temp_celsius || !targetProfile?.duration_sec) return null;
        return generateProfileCurve(targetProfile.drop_temp_celsius, targetProfile.duration_sec);
    }, [targetProfile?.drop_temp_celsius, targetProfile?.duration_sec]);

    // generateProfileCurve가 이미 30초 간격으로 샘플링된 {t, bt}[] 를 반환하므로
    // 별도 루프 없이 직접 매핑해 차트 포인트 형태로 변환한다.
    const targetSamples = useMemo(
        () =>
            targetCurve?.map((p) => ({
                time: p.t,
                btActual: null as number | null,
                etActual: null as number | null,
                rorActual: null as number | null,
                etRorActual: null as number | null,
                btTarget: p.bt,
            })) ?? [],
        [targetCurve],
    );

    // 실시간 데이터와 타깃 커브를 병합한다.
    // 같은 시각이 있을 때 실시간 포인트가 우선하므로 live를 먼저 순회한다.
    const chartData = useMemo(() => {
        /** x축 양 끝을 채우는 더미 포인트. 실제 센서 값 없이 타깃 BT만 갖는다. */
        const sentinel = (t: number) => ({
            time: t,
            btActual: null as number | null,
            etActual: null as number | null,
            rorActual: null as number | null,
            etRorActual: null as number | null,
            btTarget: targetCurve ? interpolateProfileBT(targetCurve, t) : null,
        });

        const live = livePoints.map((p) => ({
            time: p.time,
            btActual: p.bt,
            etActual: p.et,
            rorActual: p.ror,
            etRorActual: p.ror_et,
            btTarget: targetCurve ? interpolateProfileBT(targetCurve, p.time) : null,
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

        const needsStart = deduped.length === 0 || deduped[0].time > 0.5;
        const needsEnd = deduped.length === 0 || deduped[deduped.length - 1].time < CHART_TOTAL_SECS - 1;
        return [
            ...(needsStart ? [sentinel(0)] : []),
            ...deduped,
            ...(needsEnd ? [sentinel(CHART_TOTAL_SECS)] : []),
        ];
    }, [livePoints, targetCurve, targetSamples]);

    return { targetCurve, chartData };
};
