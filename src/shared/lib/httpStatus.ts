import { mapServerBatchGateError } from './features/plan-matrix';

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

/**
 * Postgres SQLSTATEs that will not succeed if repeated: data exceptions (22),
 * integrity constraints (23), and syntax/schema errors (42, including 42703 undefined_column).
 * Connection and server classes (08, 40, 53, 57, 58) stay retryable.
 */
const DETERMINISTIC_SQLSTATE = /^(22|23|42)[0-9A-Z]{3}$/;

export const isDeterministicClientError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && DETERMINISTIC_SQLSTATE.test(code);
};

const sqlStateOf = (error: unknown): string | undefined => {
    if (!error || typeof error !== 'object') return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
};

/** Client refusals that are expected and should not become Sentry issues (429 is still operational). */
export const isExpectedRefusal = (error: unknown): boolean => {
    if ((error as { name?: unknown } | null | undefined)?.name === 'BatchLimitError') return true;
    if (mapServerBatchGateError(error)) return true;
    const code = sqlStateOf(error);
    if (code === '42501') return true;
    const status = httpStatusOf(error);
    return status !== undefined && status >= 400 && status < 500 && status !== 429;
};

/** SQLSTATE 22/23/42 (except 42501) — report at warning; still non-retryable via isDeterministicClientError. */
export const isClientSqlStateWarning = (error: unknown): boolean => {
    const code = sqlStateOf(error);
    if (!code || code === '42501') return false;
    return DETERMINISTIC_SQLSTATE.test(code);
};
