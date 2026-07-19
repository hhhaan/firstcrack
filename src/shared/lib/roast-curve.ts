import { fetchTsvFromR2 } from '@shared/lib/r2';
import { parseTsv, type TsvPoint } from '@shared/lib/tsv';

/** Shared R2 TSV curve cache — History + Profiles share one namespace per path. */
export const roastCurveKeys = {
    byPath: (tsvPath: string) => ['roast_curve', tsvPath] as const,
    /** path 없는 항목 placeholder — useQueries 내 키 충돌 방지 */
    none: (fallbackKey: string) => ['roast_curve', 'none', fallbackKey] as const,
};

// TSV는 세션당 immutable — 한 번 fetch 후 영구 캐시.
export const curveQueryConfig = (tsvPath: string | null | undefined, fallbackKey?: string) => ({
    queryKey: tsvPath ? roastCurveKeys.byPath(tsvPath) : roastCurveKeys.none(fallbackKey ?? ''),
    queryFn: async (): Promise<TsvPoint[]> => {
        if (!tsvPath) return [];
        return parseTsv(await fetchTsvFromR2(tsvPath));
    },
    enabled: !!tsvPath,
    staleTime: Infinity,
    gcTime: Infinity,
});
