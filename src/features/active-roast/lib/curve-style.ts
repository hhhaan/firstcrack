import { CONTROL_CURVE_WIDTH, TEMP_CURVE_WIDTH } from './chart-config';
import type { ResolvedChartColors } from './chart-option/types';

export const CURVE_CHANNELS = ['bt', 'et', 'ror', 'etRor', 'heat', 'fan', 'drum'] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];

export const CURVE_LINE_TYPES = ['solid', 'dashed', 'dotted'] as const;
export type CurveLineType = (typeof CURVE_LINE_TYPES)[number];

/** ET RoR has no stored reference curve. */
export const BACKGROUND_CHANNELS: readonly CurveChannel[] = ['bt', 'et', 'ror', 'heat', 'fan', 'drum'];

export const CURVE_WIDTH_MIN = 0.5;
export const CURVE_WIDTH_MAX = 6;

export type CurveChannelStyle = {
    /** `#rrggbb`. null follows the DESIGN.md theme token for light and dark. */
    color: string | null;
    width: number;
    lineType: CurveLineType;
    backgroundWidth: number;
    backgroundLineType: CurveLineType;
};

export type CurveStyles = Record<CurveChannel, CurveChannelStyle>;

const channelDefault = (width: number, lineType: CurveLineType = 'solid'): CurveChannelStyle => ({
    color: null,
    width,
    lineType,
    backgroundWidth: width,
    backgroundLineType: 'dashed',
});

export const DEFAULT_CURVE_STYLES: CurveStyles = {
    bt: channelDefault(TEMP_CURVE_WIDTH),
    et: channelDefault(TEMP_CURVE_WIDTH),
    ror: channelDefault(TEMP_CURVE_WIDTH),
    etRor: channelDefault(TEMP_CURVE_WIDTH, 'dashed'),
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
    return Object.fromEntries(
        CURVE_CHANNELS.map((channel) => [channel, normalizeChannel(value[channel], DEFAULT_CURVE_STYLES[channel])]),
    ) as CurveStyles;
};

export type CurveLineStyle = { color: string; width: number; type: CurveLineType };
export type ResolvedCurveStyle = { current: CurveLineStyle; background: CurveLineStyle };
export type ResolvedCurveStyles = Record<CurveChannel, ResolvedCurveStyle>;

/** Theme colors per channel: the live line and its faded reference. */
export type CurveTokenColors = Record<CurveChannel, { current: string; background: string }>;

/** Reference alpha for a custom color, matching the 0.55 `*-target` tokens. */
const BACKGROUND_ALPHA_HEX = '8c';

/**
 * The single source for curve color, width, and dash. Lines, legends, tooltips,
 * and value readouts must all read from this so they never drift apart.
 */
export const resolveCurveStyles = (styles: CurveStyles, tokens: CurveTokenColors): ResolvedCurveStyles =>
    Object.fromEntries(
        CURVE_CHANNELS.map((channel) => {
            const style = styles[channel];
            return [
                channel,
                {
                    current: {
                        color: style.color ?? tokens[channel].current,
                        width: style.width,
                        type: style.lineType,
                    },
                    background: {
                        color: style.color ? `${style.color}${BACKGROUND_ALPHA_HEX}` : tokens[channel].background,
                        width: style.backgroundWidth,
                        type: style.backgroundLineType,
                    },
                },
            ];
        }),
    ) as ResolvedCurveStyles;

/** CSS variables for DOM legends. Theme switches need no re-render. */
export const CSS_CURVE_TOKENS: CurveTokenColors = {
    bt: { current: 'var(--color-sensor-bt)', background: 'var(--color-sensor-bt-target)' },
    et: { current: 'var(--color-sensor-et)', background: 'var(--color-sensor-et-target)' },
    ror: { current: 'var(--color-sensor-ror)', background: 'var(--color-sensor-ror-target)' },
    etRor: { current: 'var(--color-sensor-et)', background: 'var(--color-sensor-et-target)' },
    heat: { current: 'var(--color-control-heat)', background: 'var(--color-control-heat-target)' },
    fan: { current: 'var(--color-control-fan)', background: 'var(--color-control-fan-target)' },
    drum: { current: 'var(--color-control-drum)', background: 'var(--color-control-drum-target)' },
};

/** Canvas colors resolved from the same tokens, for ECharts. */
export const canvasCurveTokens = (colors: ResolvedChartColors): CurveTokenColors => ({
    bt: { current: colors.btActual, background: colors.btTarget },
    et: { current: colors.etActual, background: colors.etTarget },
    ror: { current: colors.rorActual, background: colors.rorTarget },
    etRor: { current: colors.etActual, background: colors.etTarget },
    heat: { current: colors.controlHeat, background: colors.controlHeatTarget },
    fan: { current: colors.controlFan, background: colors.controlFanTarget },
    drum: { current: colors.controlDrum, background: colors.controlDrumTarget },
});

/** Inline CSS for a short line sample. Tooltip HTML and React legends share it. */
export const curveSwatchCss = (style: CurveLineStyle): string =>
    `display:inline-block;width:16px;height:0;border-top:${style.width}px ${style.type} ${style.color};flex-shrink:0`;
