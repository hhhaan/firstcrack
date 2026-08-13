import { describe, expect, it } from 'vitest';
import { readingFreshness } from './readingFreshness';

describe('readingFreshness', () => {
    it('prefers reconnecting over a frozen last sample', () => {
        expect(readingFreshness({ connected: true, stale: true, reconnecting: true })).toBe('reconnecting');
    });

    it('marks last-good samples stale while still connected', () => {
        expect(readingFreshness({ connected: true, stale: true, reconnecting: false })).toBe('stale');
    });

    it('is live only when connected and not stale', () => {
        expect(readingFreshness({ connected: true, stale: false, reconnecting: false })).toBe('live');
        expect(readingFreshness({ connected: false, stale: false, reconnecting: false })).toBe('disconnected');
    });
});
