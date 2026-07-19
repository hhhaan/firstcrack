/** Product feature keys — single catalog. Add keys here before gating UI. */
export const FEATURE = {
    cupping: 'cupping',
    orderIntegration: 'orderIntegration',
    bbp: 'bbp',
    roastedInventory: 'roastedInventory',
    productStock: 'productStock',
    /** Shared workspace / team invites — enterprise-class only. */
    team: 'team',
} as const;

export type FeatureKey = (typeof FEATURE)[keyof typeof FEATURE];
