/** Product feature keys — single catalog. Add keys here before gating UI. */
export const FEATURE = {
    cupping: 'cupping',
} as const;

export type FeatureKey = (typeof FEATURE)[keyof typeof FEATURE];
