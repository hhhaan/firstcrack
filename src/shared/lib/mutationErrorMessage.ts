import { errorMessage, isOpaqueNetworkError } from './errorMessage';

/** Longer server messages are truncated so a toast stays one glanceable line block. */
const MAX_DETAIL_LENGTH = 160;

/**
 * Negative-stock hard blocks raised by the RPC guards (`fulfill_order`,
 * `insert_packaging_op`, `insert_product_stock_events_batch`). The migrations pin these
 * snake_case strings as a client contract, so matching on them is safe.
 */
const STOCK_GUARD_KEYS = [
    ['insufficient_product_stock', 'errors.insufficientProductStock'],
    ['insufficient_roasted_stock', 'errors.insufficientRoastedStock'],
    ['idempotency_payload_mismatch', 'errors.idempotencyPayloadMismatch'],
] as const;

type StockGuardMessageKey = (typeof STOCK_GUARD_KEYS)[number][1];

export type MutationErrorText =
    | { key: 'errors.mutationFailed' }
    | { key: StockGuardMessageKey }
    | { key: 'errors.mutationFailedDetail'; detail: string };

/**
 * A thrown `.rpc()` error is the parsed PostgREST body — a plain object, not an `Error`
 * (verified against @supabase/postgrest-js: only `throwOnError` wraps it in `PostgrestError`).
 * The RAISE message and its `USING DETAIL` land in `message` / `details`; both are scanned
 * rather than compared exactly, the same hedge `mapServerBatchGateError` uses, so a wrapped
 * or prefixed server string still maps. The two codes cannot collide.
 */
/** Postgres P0001 from assert_stock_op_receipt — not SQLSTATE 23505 (isClientRefusal noise). */
export const IDEMPOTENCY_PAYLOAD_MISMATCH_SQLSTATE = 'P0001';

const guardMessageKeyOf = (error: unknown): StockGuardMessageKey | null => {
    if (!error || typeof error !== 'object') return null;
    const { message, details, code } = error as { message?: unknown; details?: unknown; code?: unknown };
    const text = `${typeof message === 'string' ? message : ''} ${typeof details === 'string' ? details : ''}`;
    if (code === IDEMPOTENCY_PAYLOAD_MISMATCH_SQLSTATE && text.includes('idempotency_payload_mismatch')) {
        return 'errors.idempotencyPayloadMismatch';
    }
    return STOCK_GUARD_KEYS.find(([code]) => text.includes(code))?.[1] ?? null;
};

/**
 * Maps a failed mutation to the i18n key used for the global toast.
 *
 * A 4xx/5xx fork is not available here: Supabase errors carry no HTTP status
 * (`PostgrestError` is code/message/details, `FunctionsHttpError` hides the response
 * under `context`), so a status branch would collapse to "generic" for every server
 * write. The honest split is whether the failure carries a message worth showing.
 *
 * Known server guard codes are translated first — they reach the client as an untranslated
 * snake_case code that means nothing to the user. Everything else keeps the old behaviour:
 * only an `Error`/string message is surfaced, so an arbitrary Postgres error object never
 * leaks raw SQL text into a toast.
 */
export const resolveMutationErrorText = (error: unknown): MutationErrorText => {
    const guardKey = guardMessageKeyOf(error);
    if (guardKey) return { key: guardKey };

    // Only Error/string messages are surfaced — an arbitrary Postgres error object must not leak SQL.
    const raw = error instanceof Error || typeof error === 'string' ? errorMessage(error) : '';
    const detail = raw.trim();
    if (!detail || isOpaqueNetworkError(error)) return { key: 'errors.mutationFailed' };
    return {
        key: 'errors.mutationFailedDetail',
        detail: detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH)}…` : detail,
    };
};

type Translate = (key: string, options?: { message: string }) => string;

/** i18n key `errors.mutationFailedDetail` interpolates `{{message}}` — never pass `{ detail }`. */
export const formatMutationError = (t: Translate, text: MutationErrorText): string =>
    text.key === 'errors.mutationFailedDetail' ? t(text.key, { message: text.detail }) : t(text.key);
