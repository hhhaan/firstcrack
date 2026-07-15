import { useAuthStore } from '@shared/store/auth';
import type { FeatureKey } from './keys';
import { resolveFeature } from './resolve';

/** Subscribe to plan and resolve a feature key. */
export function useFeature(key: FeatureKey): boolean {
    const plan = useAuthStore((s) => s.plan);
    return resolveFeature(key, { plan });
}
