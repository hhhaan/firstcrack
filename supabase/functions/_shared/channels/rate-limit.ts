/**
 * Rate-limit backoff shared by every channel adapter (#149 / X1).
 *
 * All three platforms enforce a limit and none of them documents a `Retry-After` on the path we
 * use (`docs/research/channel-doc-common-findings.md` §X1), so the default wait is a plain
 * exponential step. A platform-stated wait, when one exists, always wins over it.
 *
 * The throttle *signal* is what differs, so each adapter injects its own reader:
 *   Naver    HTTP 429 (`GW.RATE_LIMIT` / `GW.QUOTA_LIMIT`); `GNCP-GW-RateLimit-*` headers describe
 *            the bucket but the docs define no wait derivation from them → exponential.
 *   Cafe24   HTTP 429 + `X-Cafe24-Call-Remain` / `X-Cafe24-Time-Remain` = seconds until resume.
 *   Shopify  HTTP **200** + `errors[].extensions.code = "THROTTLED"`, wait derived from
 *            `extensions.cost.throttleStatus`.
 *
 * Waiting is capped per step *and* in total, because an Edge Function has a wall clock (order-sync
 * budgets 90s for up to 25 connections). Exceeding a cap raises `RateLimitError` rather than
 * sleeping on or — worse — returning a throttled response as if it were data: order-sync only
 * writes `poll_cursor` on its success path, so propagating the failure is what keeps the watermark
 * from advancing over a window the platform refused to serve.
 */

/** One completed HTTP attempt with its body already drained — an unread body leaks across retries. */
export interface HttpAttempt {
    status: number;
    headers: Headers;
    body: string;
}

export async function readHttpAttempt(res: Response): Promise<HttpAttempt> {
    return { status: res.status, headers: res.headers, body: await res.text() };
}

export interface ThrottleSignal {
    /** Platform-stated wait in ms; null → use the exponential step. */
    waitMs: number | null;
    /** Human-readable cause, surfaced in `RateLimitError`. */
    reason: string;
}

/** Returns null when there is nothing to wait for: a good response, or a failure waiting won't fix. */
export type ThrottleReader<T> = (value: T) => ThrottleSignal | null;

export interface RetryLimits {
    /** Total attempts including the first. */
    maxAttempts: number;
    /** First exponential step; doubles per retry. */
    baseWaitMs: number;
    /** Ceiling for a single wait — a platform asking for more is refused, not clamped. */
    maxWaitMs: number;
    /** Ceiling for the sum of all waits inside one operation. */
    maxTotalWaitMs: number;
}

/** Worst case 500 + 1000 + 2000 = 3.5s per operation, well inside order-sync's 90s invocation budget. */
export const DEFAULT_RETRY_LIMITS: RetryLimits = {
    maxAttempts: 4,
    baseWaitMs: 500,
    maxWaitMs: 4_000,
    maxTotalWaitMs: 6_000,
};

export class RateLimitError extends Error {
    readonly attempts: number;
    readonly waitedMs: number;

    constructor(label: string, attempts: number, waitedMs: number, reason: string) {
        super(`${label}: rate limited — gave up after ${attempts} attempt(s), ${waitedMs}ms waited (${reason})`);
        this.name = 'RateLimitError';
        this.attempts = attempts;
        this.waitedMs = waitedMs;
    }
}

/**
 * Seconds-valued header → ms. Anything that is not a finite positive number (an HTTP-date
 * `Retry-After`, an empty string, junk) yields null so the caller falls back to the exponential
 * step. Returning NaN here would slip past every budget comparison and turn the retry loop hot.
 */
export function secondsHeaderToMs(raw: string | null | undefined): number | null {
    if (raw == null) return null;
    const seconds = Number(raw.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.ceil(seconds * 1000);
}

/**
 * 502/503/504 are the gateway failures that never reached the platform's application, so replaying
 * them is safe even for writes. 500 is deliberately excluded: it can mean the write already landed.
 */
const RETRYABLE_GATEWAY_STATUS = new Set([502, 503, 504]);

/** The part every HTTP platform shares: 429 (honouring `Retry-After` if it ever appears) + gateway 5xx. */
export function httpThrottle(attempt: HttpAttempt): ThrottleSignal | null {
    if (attempt.status === 429) {
        return { waitMs: secondsHeaderToMs(attempt.headers.get('retry-after')), reason: 'http 429' };
    }
    if (RETRYABLE_GATEWAY_STATUS.has(attempt.status)) {
        return { waitMs: null, reason: `http ${attempt.status}` };
    }
    return null;
}

/**
 * Naver returns 429 with `GNCP-GW-RateLimit-*` / `GNCP-GW-Quota-*` describing the bucket, but the
 * official docs derive no wait from them and send no `Retry-After` — exponential is the whole rule.
 */
export const naverThrottle: ThrottleReader<HttpAttempt> = httpThrottle;

/** Cafe24's documented wait is `X-Cafe24-Call-Remain` (seconds until resume), preferred over `Retry-After`. */
export function cafe24Throttle(attempt: HttpAttempt): ThrottleSignal | null {
    const signal = httpThrottle(attempt);
    if (!signal || attempt.status !== 429) return signal;

    const remainMs =
        secondsHeaderToMs(attempt.headers.get('x-cafe24-call-remain')) ??
        secondsHeaderToMs(attempt.headers.get('x-cafe24-time-remain'));
    if (remainMs == null) return signal;
    return { waitMs: remainMs, reason: `cafe24 429 (resumes in ${remainMs}ms)` };
}

type ShopifyCost = {
    requestedQueryCost?: number;
    throttleStatus?: { currentlyAvailable?: number; restoreRate?: number };
};

type ShopifyEnvelope = {
    errors?: Array<{ extensions?: { code?: string } } | null>;
    extensions?: { cost?: ShopifyCost };
};

/** Official cost model: the bucket needs (requested − available) / restoreRate seconds to cover the query. */
function shopifyCostWaitMs(cost: ShopifyCost | undefined): number | null {
    const requested = Number(cost?.requestedQueryCost);
    const available = Number(cost?.throttleStatus?.currentlyAvailable);
    const restoreRate = Number(cost?.throttleStatus?.restoreRate);
    if (!Number.isFinite(requested) || !Number.isFinite(available) || !Number.isFinite(restoreRate)) return null;
    if (restoreRate <= 0) return null;
    const deficit = requested - available;
    if (deficit <= 0) return null;
    return Math.ceil((deficit / restoreRate) * 1000);
}

/**
 * Shopify GraphQL answers a cost throttle with **HTTP 200** — the status alone says nothing, the
 * body has to be read. Resource-level limits still use 429, so both paths are covered.
 */
export function shopifyThrottle(attempt: HttpAttempt): ThrottleSignal | null {
    const http = httpThrottle(attempt);
    if (http) return http;
    // Cheap guard first: parsing a full orders page on every response would be pure waste.
    if (attempt.status !== 200 || !attempt.body.includes('THROTTLED')) return null;

    let json: ShopifyEnvelope;
    try {
        json = JSON.parse(attempt.body) as ShopifyEnvelope;
    } catch {
        return null;
    }
    const throttled = (json.errors ?? []).some((e) => e?.extensions?.code === 'THROTTLED');
    if (!throttled) return null;
    return { waitMs: shopifyCostWaitMs(json.extensions?.cost), reason: 'shopify THROTTLED' };
}

export interface RetryOptions {
    /** Prefixes `RateLimitError` so a failed run says which platform gave up. */
    label: string;
    limits?: RetryLimits;
    /** Injected by tests to assert the wait sequence without real timers. */
    sleep?: (ms: number) => Promise<void>;
}

function exponentialStep(attempt: number, limits: RetryLimits): number {
    return Math.min(limits.baseWaitMs * 2 ** (attempt - 1), limits.maxWaitMs);
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `op` until `read` stops reporting a throttle, or a limit is hit — in which case it throws.
 *
 * Only throttle signals are retried here. A rejection from `op` (network error, auth failure,
 * 4xx) propagates on the first attempt: waiting does not fix credentials or a bad request.
 */
export async function withRetry<T>(op: () => Promise<T>, read: ThrottleReader<T>, options: RetryOptions): Promise<T> {
    const limits = options.limits ?? DEFAULT_RETRY_LIMITS;
    const sleep = options.sleep ?? realSleep;
    let waitedMs = 0;

    for (let attempt = 1; ; attempt++) {
        const value = await op();
        const signal = read(value);
        if (!signal) return value;

        if (attempt >= limits.maxAttempts) {
            throw new RateLimitError(options.label, attempt, waitedMs, signal.reason);
        }
        const wait = signal.waitMs ?? exponentialStep(attempt, limits);
        if (wait > limits.maxWaitMs || waitedMs + wait > limits.maxTotalWaitMs) {
            throw new RateLimitError(
                options.label,
                attempt,
                waitedMs,
                `${signal.reason}; needs ${wait}ms more than this invocation can spend`,
            );
        }
        await sleep(wait);
        waitedMs += wait;
    }
}
