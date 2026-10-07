import type { CurveLineStyle } from '../lib/curve-style';

/** Legend line sample. Same width and dash as the chart line, so color is never the only cue. */
export const CurveSwatch = ({ style }: { style: CurveLineStyle }) => (
    <span
        aria-hidden="true"
        className="inline-block w-4 shrink-0"
        style={{ borderTop: `${style.width}px ${style.type} ${style.color}` }}
    />
);
