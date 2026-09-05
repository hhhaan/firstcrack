import { describe, expect, it } from 'vitest';
import { mapCafe24Order } from './cafe24.ts';
import { isCafe24Uninstall } from './cafe24-webhook.ts';

// Shape from https://developers.cafe24.com/ko/app/front/app/develop/webhook/sample (90077)
const uninstallPayload = {
    event_no: 90077,
    resource: {
        mall_id: 'demomall',
        client_id: 'abc123',
        app_name: 'First Crack',
        deleted_date: '2026-07-27T00:00:00+09:00',
    },
};

const orderPayload = {
    event_no: 90023,
    resource: {
        mall_id: 'demomall',
        order_id: '20260727-0000001',
        paid: 'T',
        items: [{ order_item_code: '20260727-0000001-01', quantity: 1 }],
    },
};

describe('isCafe24Uninstall', () => {
    it('detects event_no 90077', () => {
        expect(isCafe24Uninstall(uninstallPayload)).toBe(true);
        expect(isCafe24Uninstall({ event_no: '90077' })).toBe(true);
    });

    it('detects the uninstall resource shape without event_no', () => {
        expect(isCafe24Uninstall({ resource: uninstallPayload.resource })).toBe(true);
    });

    it('does not classify order payloads as uninstall', () => {
        expect(isCafe24Uninstall(orderPayload)).toBe(false);
        expect(isCafe24Uninstall({ order_id: '20260727-0000001' })).toBe(false);
        expect(isCafe24Uninstall({})).toBe(false);
    });

    it('ignores other app lifecycle events (90078/90079 out of scope)', () => {
        expect(isCafe24Uninstall({ event_no: 90078, resource: { mall_id: 'demomall' } })).toBe(false);
        expect(isCafe24Uninstall({ event_no: 90079, resource: { mall_id: 'demomall' } })).toBe(false);
    });
});

describe('mapCafe24Order (webhook resource)', () => {
    it('maps the webhook order resource with the same mapper the sync poll uses', () => {
        const order = mapCafe24Order(orderPayload.resource);
        expect(order?.platformOrderId).toBe('20260727-0000001');
        expect(order?.status).toBe('paid');
        expect(order?.lines[0]?.platformLineId).toBe('20260727-0000001-01');
        expect(order?.currency).toBe('KRW');
    });

    it('returns null without order_id', () => {
        expect(mapCafe24Order({ paid: 'T' })).toBeNull();
    });
});
