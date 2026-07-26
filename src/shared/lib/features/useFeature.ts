import type { FeatureKey } from './keys';
import { resolveFeature } from './resolve';
import { useEffectivePlan } from './useEffectivePlan';

/** Subscribe to effective workspace plan and resolve a feature key. */
export function useFeature(key: FeatureKey): boolean {
    return resolveFeature(key, { plan: useEffectivePlan(key) });
}
