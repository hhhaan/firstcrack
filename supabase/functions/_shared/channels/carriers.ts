/**
 * Canonical carrier ids → platform delivery company codes.
 * Pure TS — no Deno / npm imports (shared with vitest + client id list).
 */

/** Cafe24 codes: official shipping_company_code CSV (CJ=0006, HANJIN=0018, LOGEN=0004, …). */
export const CARRIERS = {
    cj: { naver: 'CJGLS', cafe24: '0006' },
    hanjin: { naver: 'HANJIN', cafe24: '0018' },
    lotte: { naver: 'HYUNDAI', cafe24: '0019' },
    post_office: { naver: 'EPOST', cafe24: '0012' },
    logen: { naver: 'KGB', cafe24: '0004' },
} as const;

/**
 * Official Shopify `trackingInfo.company` strings. Keys are the mapper output contract.
 *
 * Shopify auto-URL requires an exact match on
 * https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentTrackingInfo#supported-tracking-companies
 * KR domestic carriers are not on that list (crawled 2026-08), so these names are display-only.
 * Always send `trackingInfo.url` from the URL builders below.
 *
 * URL templates: each carrier's official tracking page (not SweetTracker / SmartParcel).
 *   CJ     https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=
 *   Hanjin https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&wblnumText2=
 *   Lotte  https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=
 *   Post   https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=
 *   Logen  https://www.ilogen.com/web/personal/trace/{invoice}
 */
export const SHOPIFY_TRACKING_COMPANIES = {
    'CJ Logistics': (n: string) =>
        `https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=${encodeURIComponent(n)}`,
    'Hanjin Express': (n: string) =>
        `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&wblnumText2=${encodeURIComponent(n)}`,
    'Lotte Global Logistics': (n: string) =>
        `https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${encodeURIComponent(n)}`,
    'Korea Post': (n: string) =>
        `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${encodeURIComponent(n)}`,
    Logen: (n: string) => `https://www.ilogen.com/web/personal/trace/${encodeURIComponent(n)}`,
} as const;

export type ShopifyTrackingCompany = keyof typeof SHOPIFY_TRACKING_COMPANIES;

/** Internal ids + UI 한글/en labels → official Shopify company (passthrough of official keys too). */
const SHOPIFY_INPUTS: Record<ShopifyTrackingCompany, readonly string[]> = {
    'CJ Logistics': ['cj', 'CJ대한통운', '대한통운'],
    'Hanjin Express': ['hanjin', '한진택배', '한진', 'Hanjin'],
    'Lotte Global Logistics': ['lotte', '롯데택배', '롯데', 'Lotte'],
    'Korea Post': ['post_office', '우체국택배', '우체국'],
    Logen: ['logen', '로젠택배', '로젠'],
};

function normalizeCarrierKey(raw: string): string {
    return raw.trim().toLowerCase().replace(/[\s._-]+/g, '');
}

const SHOPIFY_LOOKUP: Record<string, ShopifyTrackingCompany> = (() => {
    const out: Record<string, ShopifyTrackingCompany> = {};
    for (const name of Object.keys(SHOPIFY_TRACKING_COMPANIES) as ShopifyTrackingCompany[]) {
        out[name] = name;
        out[normalizeCarrierKey(name)] = name;
        for (const alias of SHOPIFY_INPUTS[name]) {
            out[alias] = name;
            out[normalizeCarrierKey(alias)] = name;
        }
    }
    return out;
})();

export type CarrierId = keyof typeof CARRIERS;
export type CarrierPlatform = 'naver' | 'cafe24' | 'shopify';

export function isCarrierId(id: string): id is CarrierId {
    return Object.prototype.hasOwnProperty.call(CARRIERS, id);
}

export function toShopifyTrackingCompany(input: string): ShopifyTrackingCompany {
    const trimmed = input.trim();
    const hit = SHOPIFY_LOOKUP[trimmed] ?? SHOPIFY_LOOKUP[normalizeCarrierKey(trimmed)];
    if (!hit) throw new Error(`unknown carrier: ${input}`);
    return hit;
}

export function shopifyTrackingUrl(input: string, trackingNumber: string): string {
    return SHOPIFY_TRACKING_COMPANIES[toShopifyTrackingCompany(input)](trackingNumber);
}

export function platformCarrierCode(id: CarrierId, platform: CarrierPlatform): string {
    if (platform === 'shopify') return toShopifyTrackingCompany(id);
    const row = CARRIERS[id];
    if (!row) throw new Error(`unknown carrier: ${id}`);
    return row[platform];
}

export function carrierIds(): CarrierId[] {
    return Object.keys(CARRIERS) as CarrierId[];
}
