/**
 * How far back, and how far forward, one Naver order scan walks.
 *
 * Split out of `naver.ts` purely so it is testable: `naver.ts` imports `npm:bcryptjs`, which the
 * vitest resolver cannot load, so nothing in that file can be reached from a `*.test.ts`.
 */

/** Official: omit `lastChangedTo` and the server applies +24h from `lastChangedFrom`. */
export const NAVER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Day windows one scan may walk before it stops and hands the remainder to the next run.
 *
 * This replaces the old 7-day lookback clamp (#142-1). The clamp pulled `windowStart` forward,
 * logged, and then let the scan report success — so `nextPollCursor` advanced the watermark
 * straight over the skipped range and those orders were gone for good. A budget cannot do that:
 * whatever it leaves unread comes back as `unscannedFrom`, the scan is `complete: false`, and the
 * watermark stops exactly there.
 *
 * Why this does not stall. A run that reads its windows cleanly moves the cursor forward by up to
 * 7 days, so a connection N days behind catches up over ceil(N / 7) runs instead of losing the gap
 * in one. Two paths still leave the cursor where it is, both on purpose: the per-window page cap
 * (`MAX_PAGES_PER_WINDOW`) tripping inside the *first* window, which is #125/N2's fail-closed hold
 * and beats skipping 6,000+ unread changes; and Naver refusing a very old `lastChangedFrom`, which
 * throws — order-sync then writes `last_error` / `consecutive_failures` and flips the connection to
 * `error` after five. Both are visible to an operator, which is the whole point: a gap the app
 * cannot read is now something someone can see, never something the watermark quietly steps over.
 *
 * The number 7 carries no API meaning (verification-results §3: the docs state no lookback limit).
 * It is only a wall-clock bound on a single invocation, so it can cost extra runs — never orders.
 */
export const MAX_WINDOWS_PER_RUN = 7;

export interface ScanWindow {
    /** ms, inclusive. */
    start: number;
    /** ms, exclusive. */
    end: number;
}

export interface NaverScanPlan {
    /** Contiguous windows covering [start, unscannedFrom ?? now). */
    windows: ScanWindow[];
    /** Start of the first window this run will not read; null when the whole range is planned. */
    unscannedFrom: number | null;
}

export function planNaverScan(
    requestedStart: number,
    now: number,
    maxWindows: number = MAX_WINDOWS_PER_RUN,
): NaverScanPlan {
    const windows: ScanWindow[] = [];
    // A cursor ahead of `now` (clock skew, a hand-edited row) must not produce a backwards window.
    let cursor = Math.min(requestedStart, now);

    while (cursor < now && windows.length < maxWindows) {
        const end = Math.min(cursor + NAVER_WINDOW_MS, now);
        windows.push({ start: cursor, end });
        cursor = end;
    }

    return { windows, unscannedFrom: cursor < now ? cursor : null };
}
