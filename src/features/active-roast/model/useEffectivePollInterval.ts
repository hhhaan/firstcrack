import { FEATURE, useFeature } from '@shared/lib/features';
import { coercePollIntervalForPlan, type PollIntervalMs, useRoastSettings } from './settings';

/**
 * Poll interval the app actually runs at: the stored setting, coerced to 1s when
 * the effective plan lacks FEATURE.fastPolling (stored value stays untouched).
 */
export function useEffectivePollIntervalMs(): PollIntervalMs {
    const { pollIntervalMs } = useRoastSettings();
    const canFastPoll = useFeature(FEATURE.fastPolling);
    return coercePollIntervalForPlan(pollIntervalMs, canFastPoll);
}
