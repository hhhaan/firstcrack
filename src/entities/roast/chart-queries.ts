import { roastChartKeys } from '@shared/lib/query-keys';
import { fetchTsvFromR2 } from '@shared/lib/r2';
import { parseTsv } from '@shared/lib/tsv';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export const useHistoryChart = (tsvPath: string | null) => {
    const {
        data: points = [],
        isLoading,
        isError,
    } = useQuery({
        queryKey: roastChartKeys.history(tsvPath),
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        queryFn: async () => parseTsv(await fetchTsvFromR2(tsvPath!)),
        enabled: !!tsvPath,
        staleTime: Infinity,
        gcTime: Infinity,
    });

    const xs = useMemo(() => points.map((p) => p.t), [points]);
    const btActual = useMemo(() => points.map((p) => p.bt), [points]);
    const etActual = useMemo(() => points.map((p) => p.et), [points]);
    const rorActual = useMemo(() => points.map((p) => p.ror), [points]);

    return { xs, btActual, etActual, rorActual, isLoading, isError };
};
