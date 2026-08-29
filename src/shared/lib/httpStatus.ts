/**
 * HTTP 상태 코드 추출 — axios(`response.status`)와 supabase/fetch 래퍼(`status`)가 서로 다른
 * 위치에 코드를 둔다. 재시도 정책과 Sentry 필터가 같은 판정을 쓰도록 한 곳에서만 걷는다.
 */
export const httpStatusOf = (error: unknown): number | undefined => {
    if (!error || typeof error !== 'object') return undefined;
    const candidate = error as { status?: unknown; response?: { status?: unknown } };
    const status = candidate.status ?? candidate.response?.status;
    return typeof status === 'number' ? status : undefined;
};
