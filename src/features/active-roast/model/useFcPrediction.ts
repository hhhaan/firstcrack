import { useRecentFcEvents } from '@entities/roast';
import { formatElapsed } from '@shared/lib/format';
import { useEffect, useMemo, useState } from 'react';
import {
    extractFcStartBt,
    predictFcTime,
    resolveFcTargetC,
    shouldShowFcPrediction,
    smoothFcPrediction,
} from '../lib/fcPrediction';

type UseFcPredictionParams = {
    userId: string;
    beanId: string | null;
    profileId: string | null;
    referenceEvents: unknown;
    elapsedS: number;
    bt: number | null;
    rorPerMin: number | null;
    hasYellow: boolean;
    hasFcStart: boolean;
    hasDrop: boolean;
    charged: boolean;
    roastEnded: boolean;
};

/** Live FC ETA (Cropster-style linear RoR extrapolate), EMA-smoothed for the status bar. */
export const useFcPrediction = ({
    userId,
    beanId,
    profileId,
    referenceEvents,
    elapsedS,
    bt,
    rorPerMin,
    hasYellow,
    hasFcStart,
    hasDrop,
    charged,
    roastEnded,
}: UseFcPredictionParams): { fcEta: string | null; predictedSec: number | null } => {
    const { data: rows = [] } = useRecentFcEvents(userId, beanId, profileId);
    const recentFcBts = useMemo(
        () => rows.map((r) => extractFcStartBt(r.events)).filter((v): v is number => v != null),
        [rows],
    );
    const referenceFcBt = useMemo(() => extractFcStartBt(referenceEvents), [referenceEvents]);
    const fcTargetC = resolveFcTargetC(recentFcBts, referenceFcBt);

    const raw =
        shouldShowFcPrediction({ hasYellow, hasFcStart, hasDrop, bt, fcTargetC, charged, roastEnded }) &&
        bt != null &&
        rorPerMin != null &&
        Number.isFinite(bt) &&
        Number.isFinite(rorPerMin)
            ? predictFcTime(elapsedS, bt, rorPerMin, fcTargetC)
            : null;

    const [smoothed, setSmoothed] = useState<number | null>(null);
    useEffect(() => {
        setSmoothed((prev) => smoothFcPrediction(prev, raw));
    }, [raw]);

    if (smoothed == null) return { fcEta: null, predictedSec: null };
    return { fcEta: formatElapsed(smoothed), predictedSec: smoothed };
};
