export { FeatureGate } from './FeatureGate';
export { FEATURE, type FeatureKey } from './keys';
export {
    BatchLimitError,
    canAddMachine,
    canCompleteBatch,
    isPaidPlan,
    PRO_MONTHLY_BATCH_CAP,
    planHasFeature,
    planMaxBatchesPerMonth,
    planMaxMachines,
} from './plan-matrix';
export { type FeatureContext, resolveFeature } from './resolve';
export { useFeature } from './useFeature';
