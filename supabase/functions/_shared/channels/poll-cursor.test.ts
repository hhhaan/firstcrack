import { describe, expect, it } from 'vitest';
import { nextPollCursor } from './poll-cursor.ts';

describe('nextPollCursor (#125 page cap must not lose orders)', () => {
    it('advances to the end of the window when every page was read', () => {
        expect(
            nextPollCursor({
                complete: true,
                windowEnd: '2026-07-26T10:00:00.000Z',
                resumeFrom: '2026-07-19T10:00:00.000Z',
            }),
        ).toEqual({ since: '2026-07-26T10:00:00.000Z' });
    });

    it('holds the watermark at the unread point when the page cap tripped', () => {
        expect(
            nextPollCursor({
                complete: false,
                windowEnd: '2026-07-26T10:00:00.000Z',
                resumeFrom: '2026-07-19T10:00:00.000Z',
            }),
        ).toEqual({ since: '2026-07-19T10:00:00.000Z', token: undefined });
    });

    it('keeps the page token only while the watermark is unchanged', () => {
        const truncated = nextPollCursor({
            complete: false,
            windowEnd: '2026-07-26T10:00:00.000Z',
            resumeFrom: '2026-07-19T10:00:00.000Z',
            resumeToken: 'cursor-abc',
        });
        expect(truncated).toEqual({ since: '2026-07-19T10:00:00.000Z', token: 'cursor-abc' });

        // Advancing `since` rebuilds the platform query, so the old cursor must be dropped.
        const complete = nextPollCursor({
            complete: true,
            windowEnd: '2026-07-26T10:00:00.000Z',
            resumeFrom: '2026-07-19T10:00:00.000Z',
            resumeToken: 'cursor-abc',
        });
        expect(complete.token).toBeUndefined();
    });
});
