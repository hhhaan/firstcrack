import { describe, expect, it } from 'vitest';
import {
    buildCafe24ShipmentPayload,
    buildNaverDispatchPayload,
    buildShopifyFulfillmentInput,
    nextDispatchStatus,
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

    it('shopify: fulfillmentOrderIds + trackingInfo', () => {
        const p = buildShopifyFulfillmentInput(req, ['gid://shopify/FulfillmentOrder/1']);
        expect(p.lineItemsByFulfillmentOrder).toEqual([
            { fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1' },
        ]);
        expect(p.trackingInfo).toEqual({ company: 'CJGLS', number: '123456789' });
        expect(p.notifyCustomer).toBe(true);
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
