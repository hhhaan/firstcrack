/** Stable idempotency content key — must match server packaging_request_hash inputs. */
export const packagingContentKey = (params: {
    productId: string;
    units: number;
    beanId: string | null;
    blendId: string | null;
    netWeightGrams: number;
}): string =>
    `${params.productId}|${params.units}|${params.beanId ?? ''}|${params.blendId ?? ''}|${params.netWeightGrams}`;
