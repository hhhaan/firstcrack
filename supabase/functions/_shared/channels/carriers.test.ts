import { describe, expect, it } from 'vitest';
import { CARRIER_OPTIONS } from '../../../../src/shared/lib/carriers.ts';
import {
    CARRIERS,
    SHOPIFY_TRACKING_COMPANIES,
    carrierIds,
    isCarrierId,
    platformCarrierCode,
    shopifyTrackingUrl,
    toShopifyTrackingCompany,
} from './carriers.ts';

const PLATFORMS = ['naver', 'cafe24', 'shopify'] as const;

/** Official Shopify company strings — mapper output keys, not a parallel implementation map. */
const officialShopifyCompanies = Object.keys(SHOPIFY_TRACKING_COMPANIES);

describe('carriers', () => {
    it('every CarrierId × platform returns non-empty string', () => {
        for (const id of carrierIds()) {
            for (const p of PLATFORMS) {
                const code = platformCarrierCode(id, p);
                expect(code.length).toBeGreaterThan(0);
            }
        }
    });

    it('unknown carrier throws', () => {
        expect(() => platformCarrierCode('nope' as never, 'naver')).toThrow(/unknown carrier/);
    });

    it('isCarrierId', () => {
        expect(isCarrierId('cj')).toBe(true);
        expect(isCarrierId('nope')).toBe(false);
    });

    it('client CARRIER_OPTIONS ids match EF CARRIERS keys (no drift)', () => {
        const clientIds = CARRIER_OPTIONS.map((c) => c.id).sort();
        const efIds = Object.keys(CARRIERS).sort();
        expect(clientIds).toEqual(efIds);
    });

    it('cafe24 carrier codes match official CSV', () => {
        expect(platformCarrierCode('cj', 'cafe24')).toBe('0006');
        expect(platformCarrierCode('hanjin', 'cafe24')).toBe('0018');
        expect(platformCarrierCode('logen', 'cafe24')).toBe('0004');
        expect(platformCarrierCode('lotte', 'cafe24')).toBe('0019');
        expect(platformCarrierCode('post_office', 'cafe24')).toBe('0012');
    });
});

describe('toShopifyTrackingCompany', () => {
    it('maps 한글 labels and internal ids onto official Shopify company names', () => {
        for (const opt of CARRIER_OPTIONS) {
            expect(officialShopifyCompanies).toContain(toShopifyTrackingCompany(opt.id));
            expect(officialShopifyCompanies).toContain(toShopifyTrackingCompany(opt.labelKo));
            expect(officialShopifyCompanies).toContain(toShopifyTrackingCompany(opt.labelEn));
            expect(officialShopifyCompanies).toContain(platformCarrierCode(opt.id, 'shopify'));
        }
    });

    it('passthrough of official company keys is exact', () => {
        for (const name of officialShopifyCompanies) {
            expect(toShopifyTrackingCompany(name)).toBe(name);
        }
    });

    it('unknown input throws', () => {
        expect(() => toShopifyTrackingCompany('FedEx')).toThrow(/unknown carrier/);
        expect(() => toShopifyTrackingCompany('')).toThrow(/unknown carrier/);
    });

    it('tracking URL is built from the mapped official company', () => {
        for (const opt of CARRIER_OPTIONS) {
            const company = toShopifyTrackingCompany(opt.id);
            const url = shopifyTrackingUrl(opt.labelKo, 'ABC123');
            expect(url).toMatch(/^https:\/\//);
            expect(url).toContain('ABC123');
            expect(url).toBe(SHOPIFY_TRACKING_COMPANIES[company]('ABC123'));
        }
    });
});
