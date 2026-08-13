import { describe, expect, it } from 'vitest';
import { cafe24WebhookEventId, classifyWebhookRunInsert, isCafe24Uninstall } from './cafe24-webhook.ts';

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

describe('cafe24WebhookEventId', () => {
    it('prefers event_no plus delivery fields when present', async () => {
        await expect(cafe24WebhookEventId(orderPayload)).resolves.toBe('cafe24:90023:demomall:20260727-0000001:T||||:');
        await expect(cafe24WebhookEventId({ event_no: '90025', resource: orderPayload.resource })).resolves.toBe(
            'cafe24:90025:demomall:20260727-0000001:T||||:',
        );
    });

    it('is stable across retries of the same payload', async () => {
        const a = await cafe24WebhookEventId(orderPayload);
        const b = await cafe24WebhookEventId({ ...orderPayload, resource: { ...orderPayload.resource } });
        expect(a).toBe(b);
    });

    it('differs across orders, event types, and status', async () => {
        const base = await cafe24WebhookEventId(orderPayload);
        const otherOrder = await cafe24WebhookEventId({
            ...orderPayload,
            resource: { ...orderPayload.resource, order_id: '20260727-0000002' },
        });
        const otherEvent = await cafe24WebhookEventId({ ...orderPayload, event_no: 90024 });
        const otherStatus = await cafe24WebhookEventId({
            ...orderPayload,
            resource: { ...orderPayload.resource, shipping_status: 'T' },
        });
        expect(otherOrder).not.toBe(base);
        expect(otherEvent).not.toBe(base);
        expect(otherStatus).not.toBe(base);
    });

    it('includes timestamp when present', async () => {
        const withTs = await cafe24WebhookEventId({
            ...orderPayload,
            resource: { ...orderPayload.resource, order_date: '2026-07-27T00:00:00+09:00' },
        });
        expect(withTs).toBe('cafe24:90023:demomall:20260727-0000001:T||||:2026-07-27T00:00:00+09:00');
    });

    it('hashes mall_id+order_id+status+timestamp when event_no is absent', async () => {
        const body = { resource: orderPayload.resource };
        const a = await cafe24WebhookEventId(body);
        const b = await cafe24WebhookEventId({ resource: { ...orderPayload.resource } });
        const otherOrder = await cafe24WebhookEventId({
            resource: { ...orderPayload.resource, order_id: '20260727-0000002' },
        });
        expect(a).toMatch(/^cafe24:[0-9a-f]{64}$/);
        expect(a).toBe(b);
        expect(otherOrder).not.toBe(a);
        expect(otherOrder).toMatch(/^cafe24:[0-9a-f]{64}$/);
    });

    it('returns null when nothing identifying is present', async () => {
        await expect(cafe24WebhookEventId({})).resolves.toBeNull();
    });
});

describe('classifyWebhookRunInsert (23505 duplicate delivery)', () => {
    it('returns ok when the insert succeeded', () => {
        expect(classifyWebhookRunInsert({ id: 'run-1' }, null)).toEqual({ kind: 'ok', runId: 'run-1' });
    });

    it('treats Postgres 23505 as a duplicate delivery', () => {
        expect(classifyWebhookRunInsert(null, { code: '23505', message: 'duplicate key' })).toEqual({
            kind: 'duplicate',
        });
        expect(classifyWebhookRunInsert({ id: 'ignored' }, { code: '23505' })).toEqual({ kind: 'duplicate' });
    });

    it('surfaces other insert failures', () => {
        expect(classifyWebhookRunInsert(null, { code: '23503', message: 'fk' })).toEqual({
            kind: 'error',
            message: 'fk',
        });
        expect(classifyWebhookRunInsert(null, null)).toEqual({ kind: 'error', message: 'run insert failed' });
    });
});
