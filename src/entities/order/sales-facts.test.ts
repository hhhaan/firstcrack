import { describe, expect, it } from 'vitest';
import type { OrderWithLines } from './api';
import { computeSalesFacts } from './sales-facts';

function order(
    partial: Partial<OrderWithLines> & Pick<OrderWithLines, 'platform' | 'status' | 'ordered_at'>,
): OrderWithLines {
    return {
        id: partial.id ?? crypto.randomUUID(),
        user_id: 'u1',
        connection_id: null,
        platform_order_id: partial.platform_order_id ?? 'p1',
        buyer_name: null,
        currency: 'KRW',
        total_amount: partial.total_amount ?? null,
        fulfilled_at: null,
        raw: null,
        synced_at: null,
        created_at: partial.ordered_at,
        updated_at: partial.ordered_at,
        order_lines: partial.order_lines ?? [],
        ...partial,
    };
}

const PERIOD = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.999Z' };

describe('computeSalesFacts', () => {
    it('rolls up by channelKind without hardcoding toss_place in logic', () => {
        const facts = computeSalesFacts(
            [
                order({
                    platform: 'toss_place',
                    status: 'paid',
                    ordered_at: '2026-07-10T12:00:00.000Z',
                    total_amount: 10000,
                    order_lines: [
                        {
                            id: 'l1',
                            order_id: 'o1',
                            user_id: 'u1',
                            platform_line_id: '1',
                            product_id: 'prod-a',
                            platform_product_id: 'SKU-A',
                            platform_variant_id: null,
                            title: 'Ethiopia 200g',
                            quantity: 2,
                            unit_price: 5000,
                            status: 'active',
                            created_at: '2026-07-10T12:00:00.000Z',
                        },
                    ],
                }),
                order({
                    platform: 'naver',
                    status: 'paid',
                    ordered_at: '2026-07-11T12:00:00.000Z',
                    total_amount: 30000,
                    order_lines: [],
                }),
                order({
                    platform: 'manual',
                    status: 'cancelled',
                    ordered_at: '2026-07-12T12:00:00.000Z',
                    total_amount: 5000,
                    order_lines: [],
                }),
            ],
            PERIOD,
        );

        expect(facts.totalRevenue).toBe(40000);
        expect(facts.orderCount).toBe(3);
        expect(facts.cancelledCount).toBe(1);
        expect(facts.cancelRate).toBeCloseTo(1 / 3);
        expect(facts.aov).toBe(20000);
        expect(facts.byChannelKind.pos).toEqual({ revenue: 10000, orders: 1 });
        expect(facts.byChannelKind.marketplace).toEqual({ revenue: 30000, orders: 1 });
        expect(facts.byChannelKind.manual).toEqual({ revenue: 0, orders: 1 });
        expect(facts.byPlatform.toss_place.channelKind).toBe('pos');
        expect(facts.byProduct[0]).toMatchObject({
            productId: 'prod-a',
            title: 'Ethiopia 200g',
            quantity: 2,
            revenue: 10000,
        });
        expect(facts.unmappedLineShare).toBe(0);
    });

    it('excludes orders outside period', () => {
        const facts = computeSalesFacts(
            [
                order({
                    platform: 'shopify',
                    status: 'paid',
                    ordered_at: '2026-06-01T00:00:00.000Z',
                    total_amount: 999,
                }),
            ],
            PERIOD,
        );
        expect(facts.orderCount).toBe(0);
        expect(facts.totalRevenue).toBe(0);
    });

    it('tracks unmapped SKU share on active lines', () => {
        const facts = computeSalesFacts(
            [
                order({
                    platform: 'toss_place',
                    status: 'paid',
                    ordered_at: '2026-07-15T00:00:00.000Z',
                    total_amount: 0,
                    order_lines: [
                        {
                            id: 'a',
                            order_id: 'o',
                            user_id: 'u1',
                            platform_line_id: '1',
                            product_id: null,
                            platform_product_id: null,
                            platform_variant_id: null,
                            title: 'Unknown',
                            quantity: 3,
                            unit_price: 1000,
                            status: 'active',
                            created_at: '2026-07-15T00:00:00.000Z',
                        },
                        {
                            id: 'b',
                            order_id: 'o',
                            user_id: 'u1',
                            platform_line_id: '2',
                            product_id: 'p1',
                            platform_product_id: 'x',
                            platform_variant_id: null,
                            title: 'Mapped',
                            quantity: 1,
                            unit_price: 1000,
                            status: 'active',
                            created_at: '2026-07-15T00:00:00.000Z',
                        },
                    ],
                }),
            ],
            PERIOD,
        );
        expect(facts.unmappedLineShare).toBeCloseTo(0.75);
    });
});
