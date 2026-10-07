import { describe, expect, it } from 'vitest';
import { CONTROL_CURVE_WIDTH, REFERENCE_CURVE_OPACITY, TEMP_CURVE_WIDTH } from './chart-config';
import {
    CSS_CURVE_TOKENS,
    CURVE_CHANNELS,
    DEFAULT_CURVE_STYLES,
    normalizeCurveStyles,
    resolveCurveStyles,
} from './curve-style';

describe('normalizeCurveStyles', () => {
    it('restores DESIGN.md defaults for settings saved before curve styles existed', () => {
        for (const raw of [undefined, null, 'bad', 42, [], {}]) {
            expect(normalizeCurveStyles(raw)).toEqual(DEFAULT_CURVE_STYLES);
        }
        expect(DEFAULT_CURVE_STYLES.bt).toEqual({
            color: null,
            width: TEMP_CURVE_WIDTH,
            lineType: 'solid',
            backgroundWidth: TEMP_CURVE_WIDTH,
            backgroundLineType: 'solid',
        });
        expect(DEFAULT_CURVE_STYLES.etRor.lineType).toBe('dashed');
        expect(DEFAULT_CURVE_STYLES.heat.width).toBe(CONTROL_CURVE_WIDTH);
    });

    it('falls back field by field so one bad value keeps the rest of the channel', () => {
        const styles = normalizeCurveStyles({
            bt: { color: '#FF0000', width: 3, lineType: 'zigzag', backgroundWidth: 99, backgroundLineType: 'solid' },
            ror: { color: 'red', width: Number.NaN, lineType: 'dotted', backgroundWidth: 0.5, backgroundLineType: 7 },
            et: { color: '#12345', width: '2', backgroundWidth: -1 },
            heat: 'oops',
            unknownChannel: { color: '#000000' },
        });
        expect(styles.bt).toEqual({
            color: '#ff0000',
            width: 3,
            lineType: 'solid',
            backgroundWidth: TEMP_CURVE_WIDTH,
            backgroundLineType: 'solid',
        });
        expect(styles.ror).toEqual({
            color: null,
            width: TEMP_CURVE_WIDTH,
            lineType: 'dotted',
            backgroundWidth: TEMP_CURVE_WIDTH,
            backgroundLineType: 'solid',
        });
        expect(styles.et).toEqual(DEFAULT_CURVE_STYLES.et);
        expect(styles.heat).toEqual(DEFAULT_CURVE_STYLES.heat);
        expect(Object.keys(styles)).toEqual([...CURVE_CHANNELS]);
    });

    it('rejects colors that could inject CSS into tooltip or legend markup', () => {
        for (const color of ['#fff', 'var(--x)', '#ff0000;background:url(x)', 'rgb(0,0,0)', '#ff00008c']) {
            expect(normalizeCurveStyles({ bt: { color } }).bt.color).toBeNull();
        }
    });
});

describe('resolveCurveStyles', () => {
    it('uses theme tokens until a color is set, then fades the custom color for the background', () => {
        const defaults = resolveCurveStyles(DEFAULT_CURVE_STYLES, CSS_CURVE_TOKENS);
        expect(defaults.bt).toEqual({
            current: { color: 'var(--color-sensor-bt)', width: TEMP_CURVE_WIDTH, type: 'solid' },
            background: {
                color: 'var(--color-chart-axis-label)',
                width: TEMP_CURVE_WIDTH,
                type: 'solid',
                opacity: REFERENCE_CURVE_OPACITY,
            },
        });

        const custom = resolveCurveStyles(
            {
                ...DEFAULT_CURVE_STYLES,
                ror: { color: '#00aaff', width: 2, lineType: 'solid', backgroundWidth: 3, backgroundLineType: 'solid' },
            },
            CSS_CURVE_TOKENS,
        );
        expect(custom.ror).toEqual({
            current: { color: '#00aaff', width: 2, type: 'solid' },
            background: { color: '#00aaff8c', width: 3, type: 'solid', opacity: 1 },
        });
        expect(custom.bt).toEqual(defaults.bt);
    });

    it('forces Heat current to solid even when stored as dotted or dashed', () => {
        const stored = normalizeCurveStyles({
            heat: { ...DEFAULT_CURVE_STYLES.heat, color: '#112233', lineType: 'dotted' },
        });
        expect(stored.heat.lineType).toBe('solid');
        const resolved = resolveCurveStyles(stored, {
            bt: { current: '#0', background: '#1' },
            et: { current: '#0', background: '#1' },
            ror: { current: '#0', background: '#1' },
            etRor: { current: '#0', background: '#1' },
            heat: { current: '#heat', background: '#heat-t' },
            fan: { current: '#0', background: '#1' },
            drum: { current: '#0', background: '#1' },
        });
        expect(resolved.heat.current).toEqual({ color: '#112233', width: CONTROL_CURVE_WIDTH, type: 'solid' });
    });

    it('always includes background opacity (1 for custom color, reference alpha for theme gray)', () => {
        const defaults = resolveCurveStyles(DEFAULT_CURVE_STYLES, CSS_CURVE_TOKENS);
        for (const channel of CURVE_CHANNELS) {
            expect(defaults[channel].background.opacity).toBe(REFERENCE_CURVE_OPACITY);
        }

        const custom = resolveCurveStyles(
            { ...DEFAULT_CURVE_STYLES, bt: { ...DEFAULT_CURVE_STYLES.bt, color: '#e53935' } },
            CSS_CURVE_TOKENS,
        );
        expect(custom.bt.background.opacity).toBe(1);
        expect(custom.et.background.opacity).toBe(REFERENCE_CURVE_OPACITY);
    });
});
