export { FeatureGate } from './FeatureGate';
export { FEATURE, type FeatureKey } from './keys';
export {
    type BatchGateCode,
    BatchLimitError,
    canAddMachine,
    canCompleteBatch,
    isCoreEntitled,
    isPaidPlan,
    isWritablePlan,
    mapServerBatchGateError,
    PRO_MONTHLY_BATCH_CAP,
    planHasFeature,
    planMaxBatchesPerMonth,
    planMaxMachines,
    TRIAL_BATCH_CAP,
    TRIAL_DURATION_DAYS,
    trialEndsAt,
} from './plan-matrix';
export { type FeatureContext, resolveFeature } from './resolve';
export { useFeature } from './useFeature';
export { useWriteAccess } from './useWriteAccess';
