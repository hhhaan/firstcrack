import type { SalesChannelConnection } from '@entities/sales-channel';
import { describe, expect, it } from 'vitest';
import { hasFreshCafe24Connection } from './useCafe24OAuthWait';

const WAIT_SINCE = new Date('2026-07-26T10:00:00Z').getTime();

const connection = (patch: Partial<SalesChannelConnection>): SalesChannelConnection =>
    ({
        id: 'c1',
        user_id: 'owner',
        platform: 'cafe24',
        shop_identifier: 'mymall',
        display_name: null,
        status: 'active',
        last_error: null,
        consecutive_failures: 0,
        last_polled_at: null,
        webhook_registered: false,
        auto_fulfill_on_shipped: false,
        created_at: new Date(WAIT_SINCE).toISOString(),
        updated_at: new Date(WAIT_SINCE + 1_000).toISOString(),
        ...patch,
    }) as SalesChannelConnection;

describe('hasFreshCafe24Connection', () => {
    it('matches an active connection for the requested mall, case-insensitively', () => {
        expect(hasFreshCafe24Connection([connection({})], ' MyMall ', WAIT_SINCE)).toBe(true);
    });

    it('ignores a connection for a different mall', () => {
        expect(hasFreshCafe24Connection([connection({ shop_identifier: 'other' })], 'mymall', WAIT_SINCE)).toBe(false);
    });

    it('ignores a stale connection that predates the wait', () => {
        const stale = connection({ updated_at: new Date(WAIT_SINCE - 60_000).toISOString() });
        expect(hasFreshCafe24Connection([stale], 'mymall', WAIT_SINCE)).toBe(false);
    });

    it('tolerates a callback landing just before the recorded wait start', () => {
        const early = connection({ updated_at: new Date(WAIT_SINCE - 3_000).toISOString() });
        expect(hasFreshCafe24Connection([early], 'mymall', WAIT_SINCE)).toBe(true);
    });

    it('ignores connections that are not active cafe24 rows', () => {
        expect(hasFreshCafe24Connection([connection({ status: 'pending' })], 'mymall', WAIT_SINCE)).toBe(false);
        expect(hasFreshCafe24Connection([connection({ platform: 'naver' })], '', WAIT_SINCE)).toBe(false);
    });
});
