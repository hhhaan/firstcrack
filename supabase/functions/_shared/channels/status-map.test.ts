import { describe, expect, it } from 'vitest';
import {
    cafe24ToCanonical,
    mergeStatus,
    naverToCanonical,
    shopifyToCanonical,
    tossPlaceToCanonical,
} from './status-map.ts';

describe('mergeStatus', () => {
    it('advances forward', () => {
        expect(mergeStatus('paid', 'shipped')).toBe('shipped');
    });
    it('ignores regression', () => {
        expect(mergeStatus('shipped', 'paid')).toBe('shipped');
    });
    it('applies cancel', () => {
        expect(mergeStatus('preparing', 'cancelled')).toBe('cancelled');
    });
    it('keeps terminal', () => {
        expect(mergeStatus('cancelled', 'shipped')).toBe('cancelled');
        expect(mergeStatus('refunded', 'delivered')).toBe('refunded');
    });
});

describe('naverToCanonical (official productOrderStatus)', () => {
    it('maps documented codes', () => {
        expect(naverToCanonical('PAYMENT_WAITING')).toBe('pending');
        expect(naverToCanonical('PAYED')).toBe('paid');
        expect(naverToCanonical('DELIVERING')).toBe('shipped');
        expect(naverToCanonical('DELIVERED')).toBe('delivered');
        expect(naverToCanonical('PURCHASE_DECIDED')).toBe('delivered');
        expect(naverToCanonical('CANCELED')).toBe('cancelled');
        expect(naverToCanonical('CANCELED_BY_NOPAYMENT')).toBe('cancelled');
        expect(naverToCanonical('RETURNED')).toBe('refunded');
        expect(naverToCanonical('EXCHANGED')).toBe('paid');
    });
    it('claimStatus CANCEL_DONE / RETURN_DONE', () => {
        expect(naverToCanonical('PAYED', 'CANCEL_DONE')).toBe('cancelled');
        expect(naverToCanonical('PAYED', 'RETURN_DONE')).toBe('refunded');
        expect(naverToCanonical('PAYED', 'ADMIN_CANCEL_DONE')).toBe('cancelled');
    });
    it('unknown → null', () => {
        expect(naverToCanonical('WEIRD')).toBeNull();
        // DISPATCHED is lastChangedType, not productOrderStatus
        expect(naverToCanonical('DISPATCHED')).toBeNull();
    });
});

describe('shopifyToCanonical (official financial/fulfillment filters)', () => {
    it('paid + unfulfilled', () => {
        expect(shopifyToCanonical('paid', null)).toBe('paid');
        expect(shopifyToCanonical('PAID', 'UNFULFILLED')).toBe('paid');
        expect(shopifyToCanonical('paid', 'unshipped')).toBe('paid');
    });
    it('fulfilled / shipped', () => {
        expect(shopifyToCanonical('paid', 'fulfilled')).toBe('shipped');
        expect(shopifyToCanonical('paid', 'shipped')).toBe('shipped');
    });
    it('refunded / voided / cancelledAt', () => {
        expect(shopifyToCanonical('refunded', null)).toBe('refunded');
        expect(shopifyToCanonical('voided', null)).toBe('refunded');
        expect(shopifyToCanonical('paid', 'unfulfilled', '2024-01-01T00:00:00Z')).toBe('cancelled');
    });
    it('authorized / pending', () => {
        expect(shopifyToCanonical('authorized', null)).toBe('pending');
        expect(shopifyToCanonical('pending', null)).toBe('pending');
    });
});

describe('cafe24ToCanonical (official property list)', () => {
    it('paid / canceled flags', () => {
        expect(cafe24ToCanonical({ paid: 'F', canceled: 'F' })).toBe('pending');
        expect(cafe24ToCanonical({ paid: 'T', canceled: 'F' })).toBe('paid');
        expect(cafe24ToCanonical({ paid: 'T', canceled: 'T' })).toBe('cancelled');
    });
    it('shipping_status F|M|T|W', () => {
        expect(cafe24ToCanonical({ paid: 'T', shippingStatus: 'F' })).toBe('paid');
        expect(cafe24ToCanonical({ paid: 'T', shippingStatus: 'M' })).toBe('shipped');
        expect(cafe24ToCanonical({ paid: 'T', shippingStatus: 'T' })).toBe('delivered');
        expect(cafe24ToCanonical({ paid: 'T', shippingStatus: 'W' })).toBe('preparing');
    });
    it('process_status prepare*', () => {
        expect(cafe24ToCanonical({ paid: 'T', processStatus: 'prepare' })).toBe('preparing');
        expect(cafe24ToCanonical({ paid: 'T', processStatus: 'prepareproduct' })).toBe('preparing');
    });
});

describe('tossPlaceToCanonical', () => {
    it('maps COMPLETED / CANCELLED', () => {
        expect(tossPlaceToCanonical('COMPLETED')).toBe('paid');
        expect(tossPlaceToCanonical('CANCELLED')).toBe('cancelled');
        expect(tossPlaceToCanonical('CANCELED')).toBe('cancelled');
    });
    it('maps optional REQUESTED / OPENED', () => {
        expect(tossPlaceToCanonical('REQUESTED')).toBe('pending');
        expect(tossPlaceToCanonical('OPENED')).toBe('preparing');
    });
    it('unknown → null', () => {
        expect(tossPlaceToCanonical('UNDEFINED')).toBeNull();
        expect(tossPlaceToCanonical('')).toBeNull();
    });
});
