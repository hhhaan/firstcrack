import { describe, expect, it } from 'vitest';
import { MAX_WINDOWS_PER_RUN, NAVER_WINDOW_MS, planNaverScan } from './naver-windows.ts';
import { nextPollCursor } from './poll-cursor.ts';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const daysAgo = (n: number) => NOW - n * NAVER_WINDOW_MS;

describe('planNaverScan (#142-1 — the lookback clamp must not skip a range)', () => {
    it('walks one window for the default no-cursor start', () => {
        const plan = planNaverScan(daysAgo(1), NOW);
        expect(plan.windows).toEqual([{ start: daysAgo(1), end: NOW }]);
        expect(plan.unscannedFrom).toBeNull();
    });

    it('covers a short backlog completely, in contiguous 24h windows', () => {
        const plan = planNaverScan(daysAgo(3), NOW);
        expect(plan.windows).toHaveLength(3);
        expect(plan.windows[0].start).toBe(daysAgo(3));
        expect(plan.windows.at(-1)?.end).toBe(NOW);
        for (let i = 1; i < plan.windows.length; i++) {
            expect(plan.windows[i].start).toBe(plan.windows[i - 1].end);
        }
        expect(plan.unscannedFrom).toBeNull();
    });

    it('stops at the budget and reports where it stopped instead of jumping the gap', () => {
        const plan = planNaverScan(daysAgo(30), NOW);
        expect(plan.windows).toHaveLength(MAX_WINDOWS_PER_RUN);
        expect(plan.windows[0].start).toBe(daysAgo(30));
        expect(plan.unscannedFrom).toBe(daysAgo(30 - MAX_WINDOWS_PER_RUN));
        // The reported cut-off is exactly where the planned windows end — no hole between them.
        expect(plan.unscannedFrom).toBe(plan.windows.at(-1)?.end);
    });

    it('never produces a backwards window for a cursor at or past now', () => {
        expect(planNaverScan(NOW, NOW)).toEqual({ windows: [], unscannedFrom: null });
        expect(planNaverScan(NOW + NAVER_WINDOW_MS, NOW)).toEqual({ windows: [], unscannedFrom: null });
    });
});

describe('watermark from a badly lagged cursor (the bug the clamp caused)', () => {
    it('does not advance past the unread range when the run is cut short', () => {
        const requestedStart = daysAgo(30);
        const plan = planNaverScan(requestedStart, NOW);
        const truncatedAt = plan.unscannedFrom;
        expect(truncatedAt).not.toBeNull();

        const cursor = nextPollCursor({
            complete: truncatedAt === null,
            windowEnd: new Date(NOW).toISOString(),
            resumeFrom: new Date(truncatedAt ?? NOW).toISOString(),
        });

        const since = Date.parse(cursor.since as string);
        // The old clamp published `end` here and lost 23 days of orders.
        expect(since).toBeLessThan(NOW);
        expect(since).toBe(truncatedAt);
        // Forward progress is real, so consecutive runs converge rather than stalling.
        expect(since).toBeGreaterThan(requestedStart);
    });

    it('a page cap inside an earlier window wins over the budget cut-off', () => {
        const plan = planNaverScan(daysAgo(30), NOW);
        // naver.ts sets truncatedAt = scan.start when the page cap trips mid-window.
        const truncatedAt = plan.windows[2].start;
        const cursor = nextPollCursor({
            complete: false,
            windowEnd: new Date(NOW).toISOString(),
            resumeFrom: new Date(truncatedAt).toISOString(),
        });
        expect(Date.parse(cursor.since as string)).toBe(truncatedAt);
        expect(truncatedAt).toBeLessThan(plan.unscannedFrom as number);
    });

    it('catches a 30-day backlog up run by run', () => {
        let since = daysAgo(30);
        let runs = 0;
        while (since < NOW && runs < 20) {
            const plan = planNaverScan(since, NOW);
            since = plan.unscannedFrom ?? NOW;
            runs += 1;
        }
        expect(since).toBe(NOW);
        expect(runs).toBe(Math.ceil(30 / MAX_WINDOWS_PER_RUN));
    });
});
