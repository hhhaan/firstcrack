/**
 * Canonical carrier ids → platform delivery company codes.
 * Pure TS — no Deno / npm imports (shared with vitest + client id list).
 */

export const CARRIERS = {
    cj: { naver: 'CJGLS', cafe24: '0018', shopify: 'CJ Logistics' },
    hanjin: { naver: 'HANJIN', cafe24: '0037', shopify: 'Hanjin' },
    lotte: { naver: 'HYUNDAI', cafe24: '0019', shopify: 'Lotte' },
    post_office: { naver: 'EPOST', cafe24: '0012', shopify: 'Korea Post' },
    logen: { naver: 'KGB', cafe24: '0032', shopify: 'Logen' },
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
