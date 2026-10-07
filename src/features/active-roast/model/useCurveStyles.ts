import { useMemo } from 'react';
import { CSS_CURVE_TOKENS, type ResolvedCurveStyles, resolveCurveStyles } from '../lib/curve-style';
import { useRoastSettings } from './settings';

/** DOM-side curve styles (CSS variables), from the same resolver the canvas chart uses. */
export const useCurveStyles = (): ResolvedCurveStyles => {
    const { curveStyles } = useRoastSettings();
    return useMemo(() => resolveCurveStyles(curveStyles, CSS_CURVE_TOKENS), [curveStyles]);
};
