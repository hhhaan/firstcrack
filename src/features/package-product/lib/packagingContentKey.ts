/** Stable idempotency content key — must match server packaging_request_hash inputs. */
export const packagingContentKey = (params: {
    productId: string;
    units: number;
    beanId: string | null;
    blendId: string | null;
    deltaGrams: number;
}): string =>
    `${params.productId}|${params.units}|roast_inbound|${params.beanId ?? ''}|${params.blendId ?? ''}|packaging|${params.deltaGrams}`;
