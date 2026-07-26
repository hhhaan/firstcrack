/**
 * Poll watermark rule shared by every adapter.
 *
 * Each adapter caps how many pages one sync may walk. Publishing the end of the window as the
 * next `since` after hitting that cap silently drops every unread order — permanently, because
 * the next poll starts after them. So the watermark only moves when the scan was complete.
 */

import type { PollCursor } from './types.ts';

export interface WatermarkInput {
    /** false when a page cap stopped the scan while pages were still unread. */
    complete: boolean;
    /** Watermark to publish once every page in the window was read. */
    windowEnd: string;
    /** Earliest point that still has unread pages. */
    resumeFrom: string;
    /** Platform page cursor. Only valid while `since` — and therefore the query — is unchanged. */
    resumeToken?: string;
}

export function nextPollCursor(input: WatermarkInput): PollCursor {
    // Complete: advance, and drop the page token — it belongs to the query built from the old
    // `since` and would point into the wrong result set on the next run.
    if (input.complete) return { since: input.windowEnd };
    return { since: input.resumeFrom, token: input.resumeToken };
}
