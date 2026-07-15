import type { ReactNode } from 'react';
import type { FeatureKey } from './keys';
import { useFeature } from './useFeature';

type Props = {
    feature: FeatureKey;
    children: ReactNode;
    fallback?: ReactNode;
};

/** Renders children only when feature is enabled; otherwise fallback. */
export function FeatureGate({ feature, children, fallback = null }: Props) {
    const enabled = useFeature(feature);
    if (!enabled) return <>{fallback}</>;
    return <>{children}</>;
}
