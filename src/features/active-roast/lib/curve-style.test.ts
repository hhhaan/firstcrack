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
        expect(DEFAULT_CURVE_STYLES.etRor.lineType).toBe('solid');
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

    it('replaces the previous factory widths with 2 and keeps a chosen width', () => {
        const styles = normalizeCurveStyles({
            bt: { ...DEFAULT_CURVE_STYLES.bt, width: 1.8, backgroundWidth: 1.8 },
            heat: { ...DEFAULT_CURVE_STYLES.heat, width: 1.5, backgroundWidth: 4 },
            fan: { ...DEFAULT_CURVE_STYLES.fan, width: 3 },
        });
        expect(styles.bt.width).toBe(2);
        expect(styles.bt.backgroundWidth).toBe(2);
        expect(styles.heat.width).toBe(2);
        expect(styles.heat.backgroundWidth).toBe(4);
        expect(styles.fan.width).toBe(3);
    });

    it('rejects colors that could inject CSS into tooltip or legend markup', () => {
        for (const color of ['#fff', 'var(--x)', '#ff0000;background:url(x)', 'rgb(0,0,0)', '#ff00008c']) {
            expect(normalizeCurveStyles({ bt: { color } }).bt.color).toBeNull();
        }
    });
});

describe('resolveCurveStyles', () => {
    it('makes the target the current curve at 30% opacity, ignoring stored background width and line', () => {
        const defaults = resolveCurveStyles(DEFAULT_CURVE_STYLES, CSS_CURVE_TOKENS);
        expect(defaults.bt).toEqual({
            current: { color: 'var(--color-sensor-bt)', width: TEMP_CURVE_WIDTH, type: 'solid' },
            background: {
                color: 'var(--color-sensor-bt)',
                width: TEMP_CURVE_WIDTH,
                type: 'solid',
                opacity: REFERENCE_CURVE_OPACITY,
            },
        });

        const custom = resolveCurveStyles(
            {
                ...DEFAULT_CURVE_STYLES,
                ror: {
                    color: '#00aaff',
                    width: 2,
                    lineType: 'dashed',
                    backgroundWidth: 3,
                    backgroundLineType: 'solid',
                },
            },
            CSS_CURVE_TOKENS,
        );
        expect(custom.ror).toEqual({
            current: { color: '#00aaff', width: 2, type: 'dashed' },
            background: { color: '#00aaff', width: 2, type: 'dashed', opacity: REFERENCE_CURVE_OPACITY },
        });
        expect(custom.bt).toEqual(defaults.bt);
    });

    it('keeps a stored Heat line type', () => {
        const stored = normalizeCurveStyles({
            heat: { ...DEFAULT_CURVE_STYLES.heat, color: '#112233', lineType: 'dotted' },
        });
        expect(stored.heat.lineType).toBe('dotted');
        const resolved = resolveCurveStyles(stored, {
            bt: { current: '#0' },
            et: { current: '#0' },
            ror: { current: '#0' },
            etRor: { current: '#0' },
            heat: { current: '#heat' },
            fan: { current: '#0' },
            drum: { current: '#0' },
        });
        expect(resolved.heat.current).toEqual({ color: '#112233', width: CONTROL_CURVE_WIDTH, type: 'dotted' });
        expect(resolved.heat.background).toEqual({
            color: '#112233',
            width: CONTROL_CURVE_WIDTH,
            type: 'dotted',
            opacity: REFERENCE_CURVE_OPACITY,
        });
    });
});
