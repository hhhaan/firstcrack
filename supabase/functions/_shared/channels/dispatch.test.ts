import { describe, expect, it } from 'vitest';
import { shopifyTrackingUrl, toShopifyTrackingCompany } from './carriers.ts';
import {
    buildCafe24ShipmentPayload,
    buildNaverDispatchPayload,
    buildShopifyFulfillmentInput,
    nextDispatchStatus,
    readNaverDispatchResult,
    validateTrackingNumber,
} from './dispatch.ts';
import type { MarkShippedRequest } from './types.ts';

const req: MarkShippedRequest = {
    platformOrderId: 'ORD-1',
    lines: [{ platformLineId: 'L1' }, { platformLineId: 'L2' }, { platformLineId: 'L3' }],
    carrierCode: 'CJGLS',
    trackingNumber: '123456789',
};

describe('nextDispatchStatus', () => {
    it('pending transitions', () => {
        expect(nextDispatchStatus('pending', 'api_ok')).toBe('sent');
        expect(nextDispatchStatus('pending', 'api_already_shipped')).toBe('sent');
        expect(nextDispatchStatus('pending', 'api_err')).toBe('failed');
    });

    it('sent + inbound_shipped → confirmed', () => {
        expect(nextDispatchStatus('sent', 'inbound_shipped')).toBe('confirmed');
    });

    it('failed + retry → pending', () => {
        expect(nextDispatchStatus('failed', 'retry')).toBe('pending');
    });

    it('confirmed is terminal', () => {
        expect(nextDispatchStatus('confirmed', 'api_ok')).toBe('confirmed');
        expect(nextDispatchStatus('confirmed', 'inbound_shipped')).toBe('confirmed');
        expect(nextDispatchStatus('confirmed', 'retry')).toBe('confirmed');
    });

    it('sent + api_ok stays sent', () => {
        expect(nextDispatchStatus('sent', 'api_ok')).toBe('sent');
    });

    it('undefined transition keeps current', () => {
        expect(nextDispatchStatus('pending', 'inbound_shipped')).toBe('pending');
    });
});

describe('payload builders', () => {
    it('naver: one dispatch row per line', () => {
        const p = buildNaverDispatchPayload(req);
        expect(p.dispatchProductOrders).toHaveLength(3);
        expect(p.dispatchProductOrders[0]).toMatchObject({
            productOrderId: 'L1',
            deliveryMethod: 'DELIVERY',
            deliveryCompanyCode: 'CJGLS',
            trackingNumber: '123456789',
        });
        expect(p.dispatchProductOrders[0].dispatchDate).toBeTruthy();
    });

    it('cafe24: order_item_code has all lines, status shipping', () => {
        const p = buildCafe24ShipmentPayload(req);
        expect(p.request.order_item_code).toEqual(['L1', 'L2', 'L3']);
        expect(p.request.status).toBe('shipping');
        expect(p.request.tracking_no).toBe('123456789');
        expect(p.request.shipping_company_code).toBe('CJGLS');
        expect(p.request.order_id).toBe('ORD-1');
    });

    it('shopify: fulfillmentOrderIds + official company + tracking url', () => {
        const shopifyReq = { ...req, carrierCode: 'cj' };
        const p = buildShopifyFulfillmentInput(shopifyReq, ['gid://shopify/FulfillmentOrder/1']);
        const company = toShopifyTrackingCompany('cj');
        expect(p.lineItemsByFulfillmentOrder).toEqual([
            { fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1' },
        ]);
        expect(p.trackingInfo).toEqual({
            company,
            number: '123456789',
            url: shopifyTrackingUrl(company, '123456789'),
        });
        expect(p.notifyCustomer).toBe(true);
    });

    it('shopify: 한글 label maps to the same official company + url', () => {
        const p = buildShopifyFulfillmentInput(
            { ...req, carrierCode: '한진택배' },
            ['gid://shopify/FulfillmentOrder/1'],
        );
        const company = toShopifyTrackingCompany('hanjin');
        expect(p.trackingInfo.company).toBe(company);
        expect(p.trackingInfo.url).toBe(shopifyTrackingUrl('hanjin', '123456789'));
    });
});

describe('readNaverDispatchResult (N3 — ok drives fulfill_order, so fail-closed)', () => {
    it('all lines confirmed → ok', () => {
        const r = readNaverDispatchResult(
            { data: { successProductOrderIds: ['L1', 'L2', 'L3'] } },
            req.lines,
        );
        expect(r.ok).toBe(true);
        expect(r.alreadyShipped).toBe(false);
        expect(r.lineResults?.every((l) => l.ok)).toBe(true);
        expect(r.error).toBeUndefined();
    });

    it('partial dispatch: only the listed ids are ok, and the whole result is not ok', () => {
        const r = readNaverDispatchResult(
            {
                data: {
                    successProductOrderIds: ['L1'],
                    failProductOrderInfos: [{ productOrderId: 'L2' }, { productOrderId: 'L3' }],
                },
            },
            req.lines,
        );
        expect(r.ok).toBe(false);
        expect(r.lineResults).toEqual([
            { platformLineId: 'L1', ok: true, error: undefined },
            { platformLineId: 'L2', ok: false, error: 'not listed in successProductOrderIds' },
            { platformLineId: 'L3', ok: false, error: 'not listed in successProductOrderIds' },
        ]);
        expect(r.error).toContain('L2');
        expect(r.error).toContain('L3');
    });

    it('every line failed → not ok', () => {
        const r = readNaverDispatchResult(
            { data: { successProductOrderIds: [], failProductOrderInfos: [{}, {}, {}] } },
            req.lines,
        );
        expect(r.ok).toBe(false);
        expect(r.lineResults?.some((l) => l.ok)).toBe(false);
    });

    it('fails closed on an unexpected data shape', () => {
        // The old code read `data` as an array, so this shape silently marked every line ok and
        // let order-dispatch deduct stock for orders that never shipped.
        for (const json of [
            {},
            { data: undefined },
            { data: {} },
            { data: { successProductOrderIds: 'L1' } },
            { data: [{ productOrderId: 'L1', code: 'SUCCESS' }] } as never,
        ]) {
            const r = readNaverDispatchResult(json, req.lines);
            expect(r.ok).toBe(false);
            expect(r.lineResults?.some((l) => l.ok)).toBe(false);
        }
    });

    it('an empty request set is not a success', () => {
        const r = readNaverDispatchResult({ data: { successProductOrderIds: [] } }, []);
        expect(r.ok).toBe(false);
    });

    it('ignores success ids that were not requested', () => {
        const r = readNaverDispatchResult(
            { data: { successProductOrderIds: ['L1', 'L2', 'L3', 'L9'] } },
            [{ platformLineId: 'L1' }],
        );
        expect(r.ok).toBe(true);
        expect(r.lineResults).toHaveLength(1);
    });

    it('coerces numeric product order ids', () => {
        const r = readNaverDispatchResult({ data: { successProductOrderIds: [1234] } }, [
            { platformLineId: '1234' },
        ]);
        expect(r.ok).toBe(true);
    });
});

describe('validateTrackingNumber', () => {
    it('rejects empty / internal whitespace', () => {
        expect(() => validateTrackingNumber('')).toThrow();
        expect(() => validateTrackingNumber('  ')).toThrow();
        expect(() => validateTrackingNumber('12 34')).toThrow();
        expect(() => validateTrackingNumber(' 12 34 ')).toThrow();
    });

    it('trims valid', () => {
        expect(validateTrackingNumber('123456789')).toBe('123456789');
        expect(validateTrackingNumber(' 12345 ')).toBe('12345');
    });
});
