import { describe, expect, it } from 'vitest';
import {
    cafe24Throttle,
    type HttpAttempt,
    naverThrottle,
    RateLimitError,
    type RetryLimits,
    secondsHeaderToMs,
    shopifyThrottle,
    withRetry,
} from './rate-limit.ts';

function attempt(status: number, headers: Record<string, string> = {}, body = ''): HttpAttempt {
    return { status, headers: new Headers(headers), body };
}

const LIMITS: RetryLimits = { maxAttempts: 4, baseWaitMs: 500, maxWaitMs: 4_000, maxTotalWaitMs: 6_000 };

/** Collects what would have been slept so a test can assert the exact wait sequence. */
function recorder() {
    const waits: number[] = [];
    return {
        waits,
        sleep: (ms: number) => {
            waits.push(ms);
            return Promise.resolve();
        },
    };
}

describe('secondsHeaderToMs', () => {
    it('converts a numeric seconds header', () => {
        expect(secondsHeaderToMs('2')).toBe(2_000);
        expect(secondsHeaderToMs(' 1.5 ')).toBe(1_500);
    });

    it('rejects anything not finite and positive — NaN would slip past every budget check', () => {
        expect(secondsHeaderToMs(null)).toBeNull();
        expect(secondsHeaderToMs('')).toBeNull();
        expect(secondsHeaderToMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
        expect(secondsHeaderToMs('0')).toBeNull();
        expect(secondsHeaderToMs('-5')).toBeNull();
        expect(secondsHeaderToMs('Infinity')).toBeNull();
    });
});

describe('naverThrottle', () => {
    it('429 with Retry-After is honoured even though the docs never promise one', () => {
        expect(naverThrottle(attempt(429, { 'retry-after': '2' }))?.waitMs).toBe(2_000);
    });

    it('429 without Retry-After falls back to exponential', () => {
        expect(naverThrottle(attempt(429, { 'gncp-gw-ratelimit-remaining': '0' }))).toEqual({
            waitMs: null,
            reason: 'http 429',
        });
    });

    it('retries gateway 5xx but never a plain 500 — that one may have applied the write', () => {
        expect(naverThrottle(attempt(502))?.waitMs).toBeNull();
        expect(naverThrottle(attempt(503))?.waitMs).toBeNull();
        expect(naverThrottle(attempt(504))?.waitMs).toBeNull();
        expect(naverThrottle(attempt(500))).toBeNull();
    });

    it('does not retry success or 4xx', () => {
        expect(naverThrottle(attempt(200, {}, '{}'))).toBeNull();
        expect(naverThrottle(attempt(400))).toBeNull();
        expect(naverThrottle(attempt(401))).toBeNull();
    });
});

describe('cafe24Throttle', () => {
    it('prefers X-Cafe24-Call-Remain (seconds until resume) over Retry-After', () => {
        const signal = cafe24Throttle(attempt(429, { 'retry-after': '9', 'x-cafe24-call-remain': '3' }));
        expect(signal?.waitMs).toBe(3_000);
    });

    it('falls back to X-Cafe24-Time-Remain, then to exponential', () => {
        expect(cafe24Throttle(attempt(429, { 'x-cafe24-time-remain': '2' }))?.waitMs).toBe(2_000);
        expect(cafe24Throttle(attempt(429, { 'x-api-call-limit': '40/40' }))?.waitMs).toBeNull();
    });

    it('ignores an unparseable remain header instead of sleeping NaN', () => {
        expect(cafe24Throttle(attempt(429, { 'x-cafe24-call-remain': 'soon' }))?.waitMs).toBeNull();
    });

    it('leaves non-throttle responses alone', () => {
        expect(cafe24Throttle(attempt(200, { 'x-api-call-limit': '1/40' }, '{}'))).toBeNull();
        expect(cafe24Throttle(attempt(422))).toBeNull();
    });
});

describe('shopifyThrottle (throttle arrives as HTTP 200)', () => {
    const throttledBody = JSON.stringify({
        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
        extensions: {
            cost: {
                requestedQueryCost: 302,
                throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 100, restoreRate: 100 },
            },
        },
    });

    it('detects THROTTLED in a 200 body and waits (requested - available) / restoreRate', () => {
        // (302 - 100) / 100 = 2.02s
        expect(shopifyThrottle(attempt(200, {}, throttledBody))).toEqual({
            waitMs: 2_020,
            reason: 'shopify THROTTLED',
        });
    });

    it('falls back to exponential when throttleStatus is unusable', () => {
        const body = JSON.stringify({
            errors: [{ extensions: { code: 'THROTTLED' } }],
            extensions: { cost: { throttleStatus: { restoreRate: 0 } } },
        });
        expect(shopifyThrottle(attempt(200, {}, body))?.waitMs).toBeNull();
    });

    it('does not retry other GraphQL errors, or a clean 200', () => {
        const denied = JSON.stringify({ errors: [{ extensions: { code: 'ACCESS_DENIED' } }] });
        expect(shopifyThrottle(attempt(200, {}, denied))).toBeNull();
        expect(shopifyThrottle(attempt(200, {}, '{"data":{"shop":{"name":"x"}}}'))).toBeNull();
        expect(shopifyThrottle(attempt(200, {}, 'not json THROTTLED'))).toBeNull();
    });

    it('still handles the resource-level 429 path', () => {
        expect(shopifyThrottle(attempt(429, { 'retry-after': '1' }))?.waitMs).toBe(1_000);
    });
});

describe('withRetry', () => {
    it('returns the first non-throttled value without sleeping', async () => {
        const { waits, sleep } = recorder();
        let calls = 0;
        const value = await withRetry(
            () => {
                calls += 1;
                return Promise.resolve(attempt(200, {}, '{}'));
            },
            naverThrottle,
            { label: 'naver', limits: LIMITS, sleep },
        );
        expect(value.status).toBe(200);
        expect(calls).toBe(1);
        expect(waits).toEqual([]);
    });

    it('sleeps exactly the Retry-After the platform asked for', async () => {
        const { waits, sleep } = recorder();
        const responses = [attempt(429, { 'retry-after': '2' }), attempt(200, {}, '{}')];
        const value = await withRetry(() => Promise.resolve(responses.shift() as HttpAttempt), naverThrottle, {
            label: 'naver',
            limits: LIMITS,
            sleep,
        });
        expect(value.status).toBe(200);
        expect(waits).toEqual([2_000]);
    });

    it('backs off exponentially when the 429 carries no wait hint', async () => {
        const { waits, sleep } = recorder();
        const responses = [attempt(429), attempt(429), attempt(200, {}, '{}')];
        await withRetry(() => Promise.resolve(responses.shift() as HttpAttempt), naverThrottle, {
            label: 'naver',
            limits: LIMITS,
            sleep,
        });
        expect(waits).toEqual([500, 1_000]);
    });

    it('propagates a RateLimitError once the attempt cap is spent — never a throttled value', async () => {
        const { waits, sleep } = recorder();
        let calls = 0;
        await expect(
            withRetry(
                () => {
                    calls += 1;
                    return Promise.resolve(attempt(429));
                },
                naverThrottle,
                { label: 'naver', limits: LIMITS, sleep },
            ),
        ).rejects.toBeInstanceOf(RateLimitError);
        expect(calls).toBe(LIMITS.maxAttempts);
        expect(waits).toEqual([500, 1_000, 2_000]);
    });

    it('refuses a platform wait it cannot afford instead of sleeping through the invocation', async () => {
        const { waits, sleep } = recorder();
        await expect(
            withRetry(() => Promise.resolve(attempt(429, { 'x-cafe24-call-remain': '30' })), cafe24Throttle, {
                label: 'cafe24',
                limits: LIMITS,
                sleep,
            }),
        ).rejects.toThrow(/rate limited/);
        expect(waits).toEqual([]);
    });

    it('stops when the accumulated wait would exceed the total budget', async () => {
        const { waits, sleep } = recorder();
        const tight: RetryLimits = { maxAttempts: 9, baseWaitMs: 1_000, maxWaitMs: 4_000, maxTotalWaitMs: 2_500 };
        await expect(
            withRetry(() => Promise.resolve(attempt(503)), naverThrottle, {
                label: 'naver',
                limits: tight,
                sleep,
            }),
        ).rejects.toBeInstanceOf(RateLimitError);
        // 1000 + 2000 = 3000 > 2500, so the second wait is refused.
        expect(waits).toEqual([1_000]);
    });

    it('lets a rejection out on the first attempt — waiting does not fix auth or a bad request', async () => {
        const { waits, sleep } = recorder();
        let calls = 0;
        await expect(
            withRetry(
                () => {
                    calls += 1;
                    return Promise.reject(new Error('network down'));
                },
                naverThrottle,
                { label: 'naver', limits: LIMITS, sleep },
            ),
        ).rejects.toThrow('network down');
        expect(calls).toBe(1);
        expect(waits).toEqual([]);
    });
});
