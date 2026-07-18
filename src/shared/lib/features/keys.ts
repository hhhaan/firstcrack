/** Product feature keys — single catalog. Add keys here before gating UI. */
export const FEATURE = {
    cupping: 'cupping',
    orderIntegration: 'orderIntegration',
    bbp: 'bbp',
    roastedInventory: 'roastedInventory',
    productStock: 'productStock',
} as const;

export type FeatureKey = (typeof FEATURE)[keyof typeof FEATURE];
