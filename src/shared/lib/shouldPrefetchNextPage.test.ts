import { describe, expect, it } from 'vitest';
import { shouldPrefetchNextPage } from './shouldPrefetchNextPage';

const ready = {
    enabled: true,
    isSuccess: true,
    isPlaceholderData: false,
};

describe('shouldPrefetchNextPage', () => {
    it('enables N+1 when current page has a next page', () => {
        expect(shouldPrefetchNextPage({ ...ready, page: 1, pageSize: 10, total: 11 })).toBe(true);
        expect(shouldPrefetchNextPage({ ...ready, page: 2, pageSize: 20, total: 41 })).toBe(true);
    });

    it('skips the last page (exact fill and partial)', () => {
        expect(shouldPrefetchNextPage({ ...ready, page: 2, pageSize: 10, total: 20 })).toBe(false);
        expect(shouldPrefetchNextPage({ ...ready, page: 2, pageSize: 10, total: 15 })).toBe(false);
        expect(shouldPrefetchNextPage({ ...ready, page: 1, pageSize: 10, total: 10 })).toBe(false);
        expect(shouldPrefetchNextPage({ ...ready, page: 1, pageSize: 10, total: 0 })).toBe(false);
    });

    it('skips when the current query is disabled (History client filter)', () => {
        expect(
            shouldPrefetchNextPage({
                ...ready,
                enabled: false,
                page: 1,
                pageSize: 10,
                total: 100,
            }),
        ).toBe(false);
    });

    it('skips while current data is placeholder so previous total cannot enable N+1', () => {
        expect(
            shouldPrefetchNextPage({
                enabled: true,
                page: 1,
                pageSize: 10,
                total: 100,
                isSuccess: true,
                isPlaceholderData: true,
            }),
        ).toBe(false);
    });

    it('skips before the current page has succeeded', () => {
        expect(
            shouldPrefetchNextPage({
                enabled: true,
                page: 1,
                pageSize: 10,
                total: 100,
                isSuccess: false,
                isPlaceholderData: false,
            }),
        ).toBe(false);
        expect(
            shouldPrefetchNextPage({
                ...ready,
                page: 1,
                pageSize: 10,
                total: undefined,
            }),
        ).toBe(false);
    });
});
