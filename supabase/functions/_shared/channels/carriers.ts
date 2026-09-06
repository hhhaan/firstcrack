/**
 * Canonical carrier ids → platform delivery company codes.
 * Pure TS — no Deno / npm imports (shared with vitest + client id list).
 */

/** Cafe24 codes: official shipping_company_code CSV (CJ=0006, HANJIN=0018, LOGEN=0004, …). */
export const CARRIERS = {
    cj: { naver: 'CJGLS', cafe24: '0006', shopify: 'CJ Logistics' },
    hanjin: { naver: 'HANJIN', cafe24: '0018', shopify: 'Hanjin' },
    lotte: { naver: 'HYUNDAI', cafe24: '0019', shopify: 'Lotte' },
    post_office: { naver: 'EPOST', cafe24: '0012', shopify: 'Korea Post' },
    logen: { naver: 'KGB', cafe24: '0004', shopify: 'Logen' },
    dhl: { naver: 'DHL', cafe24: '0026', shopify: 'DHL Express' },
    fedex: { naver: 'FEDEX', cafe24: '0027', shopify: 'FedEx' },
    ups: { naver: 'UPS', cafe24: '0028', shopify: 'UPS' },
    other: { naver: 'DIRECT', cafe24: '9999', shopify: 'Other' },
} as const;

export type CarrierId = keyof typeof CARRIERS;
export type CarrierPlatform = 'naver' | 'cafe24' | 'shopify';

export function isCarrierId(id: string): id is CarrierId {
    return Object.prototype.hasOwnProperty.call(CARRIERS, id);
}

export function platformCarrierCode(id: CarrierId, platform: CarrierPlatform): string {
    const row = CARRIERS[id];
    if (!row) throw new Error(`unknown carrier: ${id}`);
    return row[platform];
}

export function carrierIds(): CarrierId[] {
    return Object.keys(CARRIERS) as CarrierId[];
}
