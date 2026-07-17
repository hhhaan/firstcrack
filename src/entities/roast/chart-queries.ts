import { roastChartKeys } from '@shared/lib/query-keys';
import { fetchTsvFromR2 } from '@shared/lib/r2';
import { parseTsv, type TsvPoint } from '@shared/lib/tsv';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

// TSV는 세션당 immutable — 한 번 fetch 후 영구 캐시.
const historyChartQueryConfig = (tsvPath: string | null, fallbackKey?: string) => ({
    queryKey: tsvPath ? roastChartKeys.history(tsvPath) : roastChartKeys.historyNone(fallbackKey ?? ''),
    queryFn: async (): Promise<TsvPoint[]> => (tsvPath ? parseTsv(await fetchTsvFromR2(tsvPath)) : []),
    enabled: !!tsvPath,
    staleTime: Infinity,
    gcTime: Infinity,
});

export const useHistoryChart = (tsvPath: string | null) => {
    const { data: points = [], isLoading, isError } = useQuery(historyChartQueryConfig(tsvPath));

    const xs = useMemo(() => points.map((p) => p.t), [points]);
    const btActual = useMemo(() => points.map((p) => p.bt), [points]);
    const etActual = useMemo(() => points.map((p) => p.et), [points]);
    const rorActual = useMemo(() => points.map((p) => p.ror), [points]);

    return { xs, btActual, etActual, rorActual, isLoading, isError };
};

/** 비교 모드용 — paths 순서대로 결과 배열 반환. 단건 expand 캐시(roastChartKeys.history)와 공유. */
export const useHistoryCharts = (tsvPaths: (string | null)[], fallbackKeys: string[] = []) =>
    useQueries({
        queries: tsvPaths.map((p, i) => historyChartQueryConfig(p, fallbackKeys[i])),
    });
