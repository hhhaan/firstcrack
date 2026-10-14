import {
    CONTROL_CURVE_WIDTH,
    type getResolvedChartColors,
    REFERENCE_CURVE_OPACITY,
    TEMP_CURVE_WIDTH,
} from './chart-config';

type ResolvedChartColors = ReturnType<typeof getResolvedChartColors>;

export const CURVE_CHANNELS = ['bt', 'et', 'ror', 'etRor', 'heat', 'fan', 'drum'] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];

export const CURVE_LINE_TYPES = ['solid', 'dashed', 'dotted'] as const;
export type CurveLineType = (typeof CURVE_LINE_TYPES)[number];

export const CURVE_WIDTH_MIN = 1;
export const CURVE_WIDTH_MAX = 6;

export type CurveChannelStyle = {
    /** `#rrggbb`. null follows the DESIGN.md theme token for light and dark. */
    color: string | null;
    width: number;
    lineType: CurveLineType;
    /** Kept so older settings still load. The target inherits `width` and `lineType`. */
    backgroundWidth: number;
    /** Kept so older settings still load. The target inherits `lineType`. */
    backgroundLineType: CurveLineType;
};

export type CurveStyles = Record<CurveChannel, CurveChannelStyle>;

const channelDefault = (width: number): CurveChannelStyle => ({
    color: null,
    width,
    lineType: 'solid',
    backgroundWidth: width,
    backgroundLineType: 'solid',
});

export const DEFAULT_CURVE_STYLES: CurveStyles = {
    bt: channelDefault(TEMP_CURVE_WIDTH),
    et: channelDefault(TEMP_CURVE_WIDTH),
    ror: channelDefault(TEMP_CURVE_WIDTH),
    etRor: channelDefault(TEMP_CURVE_WIDTH),
    heat: channelDefault(CONTROL_CURVE_WIDTH),
    fan: channelDefault(CONTROL_CURVE_WIDTH),
    drum: channelDefault(CONTROL_CURVE_WIDTH),
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const isCurveColor = (value: unknown): value is string => typeof value === 'string' && HEX_COLOR.test(value);

const isLineType = (value: unknown): value is CurveLineType =>
    typeof value === 'string' && (CURVE_LINE_TYPES as readonly string[]).includes(value);

const isWidth = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= CURVE_WIDTH_MIN && value <= CURVE_WIDTH_MAX;

const normalizeChannel = (raw: unknown, fallback: CurveChannelStyle): CurveChannelStyle => {
    const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof CurveChannelStyle, unknown>>;
    // Invalid fields use DESIGN defaults for this channel, not any previously stored value on the object.
    return {
        color: isCurveColor(value.color) ? value.color.toLowerCase() : null,
        width: isWidth(value.width) ? value.width : fallback.width,
        lineType: isLineType(value.lineType) ? value.lineType : fallback.lineType,
        backgroundWidth: isWidth(value.backgroundWidth) ? value.backgroundWidth : fallback.backgroundWidth,
        backgroundLineType: isLineType(value.backgroundLineType)
            ? value.backgroundLineType
            : fallback.backgroundLineType,
    };
};

/** Each field falls back on its own, so one bad value never resets the rest of a channel. */
export const normalizeCurveStyles = (raw: unknown): CurveStyles => {
    const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<CurveChannel, unknown>>;
    const styles = Object.fromEntries(
        CURVE_CHANNELS.map((channel) => [channel, normalizeChannel(value[channel], DEFAULT_CURVE_STYLES[channel])]),
    ) as CurveStyles;
    return styles;
};

export type CurveLineStyle = { color: string; width: number; type: CurveLineType; opacity?: number };
export type ResolvedCurveStyle = { current: CurveLineStyle; background: CurveLineStyle };
export type ResolvedCurveStyles = Record<CurveChannel, ResolvedCurveStyle>;

/** Theme color per channel. The target curve inherits this color at {@link REFERENCE_CURVE_OPACITY}. */
export type CurveTokenColors = Record<CurveChannel, { current: string }>;

/**
 * The single source for curve color, width, and dash. Lines, legends, tooltips,
 * and value readouts must all read from this so they never drift apart.
 * The target copies the current curve and draws it at 30% opacity.
 */
export const resolveCurveStyles = (styles: CurveStyles, tokens: CurveTokenColors): ResolvedCurveStyles =>
    Object.fromEntries(
        CURVE_CHANNELS.map((channel) => {
            const style = styles[channel];
            const current: CurveLineStyle = {
                color: style.color ?? tokens[channel].current,
                width: style.width,
                type: style.lineType,
            };
            return [
                channel,
                {
                    current,
                    background: { ...current, opacity: REFERENCE_CURVE_OPACITY },
                },
            ];
        }),
    ) as ResolvedCurveStyles;

/** CSS variables for DOM legends. Theme switches need no re-render. */
export const CSS_CURVE_TOKENS: CurveTokenColors = {
    bt: { current: 'var(--color-sensor-bt)' },
    et: { current: 'var(--color-sensor-et)' },
    ror: { current: 'var(--color-sensor-ror)' },
    etRor: { current: 'var(--color-sensor-et)' },
    heat: { current: 'var(--color-control-heat)' },
    fan: { current: 'var(--color-control-fan)' },
    drum: { current: 'var(--color-control-drum)' },
};

/** Canvas colors resolved from the same tokens, for ECharts. */
export const canvasCurveTokens = (colors: ResolvedChartColors): CurveTokenColors => ({
    bt: { current: colors.btActual },
    et: { current: colors.etActual },
    ror: { current: colors.rorActual },
    etRor: { current: colors.etActual },
    heat: { current: colors.controlHeat },
    fan: { current: colors.controlFan },
    drum: { current: colors.controlDrum },
});

/** Inline CSS for a short line sample. Tooltip HTML and React legends share it. */
export const curveSwatchCss = (style: CurveLineStyle): string => {
    const opacity = style.opacity == null ? '' : `opacity:${style.opacity};`;
    return `display:inline-block;width:16px;height:0;border-top:${style.width}px ${style.type} ${style.color};${opacity}flex-shrink:0`;
};
