import { curveQueryConfig } from '@shared/lib/roast-curve';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export const useHistoryChart = (tsvPath: string | null) => {
    const { data: points = [], isLoading, isError } = useQuery(curveQueryConfig(tsvPath));

    const xs = useMemo(() => points.map((p) => p.t), [points]);
    const btActual = useMemo(() => points.map((p) => p.bt), [points]);
    const etActual = useMemo(() => points.map((p) => p.et), [points]);
    const rorActual = useMemo(() => points.map((p) => p.ror), [points]);

    return { xs, btActual, etActual, rorActual, isLoading, isError };
};

/** 비교 모드용 — paths 순서대로 결과 배열 반환. 단건 expand 캐시와 공유. */
export const useHistoryCharts = (tsvPaths: (string | null)[], fallbackKeys: string[] = []) =>
    useQueries({
        queries: tsvPaths.map((p, i) => curveQueryConfig(p, fallbackKeys[i])),
    });

const bbpCurveKeys = {
    bySession: (ownerId: string, sessionId: string | null, path: string | null) =>
        ['bbp_curve', ownerId, sessionId, path] as const,
};

/** BBP is immutable and belongs to the session whose Charge ends it. */
export const useBbpCurve = (
    ownerId: string,
    sessionId: string | null,
    tsvPath: string | null | undefined,
    enabled = true,
) => {
    const path = enabled && ownerId && sessionId ? tsvPath : null;
    return useQuery({
        ...curveQueryConfig(path),
        queryKey: bbpCurveKeys.bySession(ownerId, sessionId, path ?? null),
        placeholderData: undefined,
        throwOnError: false,
    });
};
