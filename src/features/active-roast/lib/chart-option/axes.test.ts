import { formatElapsed } from '@shared/lib/format';
import { describe, expect, it } from 'vitest';
import { buildCrossLineStyle, buildTooltipCrossPointer, buildXAxisPointer, buildYAxisPointer, fmtSec } from './axes';
import { mockChartColors } from './chart-colors.fixture';

describe('fmtSec', () => {
    it('wraps formatElapsed and prefixes negatives for axis ticks', () => {
        expect(fmtSec(90.6)).toBe(formatElapsed(90.6));
        expect(fmtSec(90.6)).toBe('1:30');
        expect(fmtSec(-90.6)).toBe(`-${formatElapsed(90.6)}`);
        expect(fmtSec(-90.6)).toBe('-1:30');
    });
});

describe('buildTooltipCrossPointer', () => {
    const format = buildTooltipCrossPointer(buildCrossLineStyle(mockChartColors)).label.formatter;

    it('writes the x crosshair tag as m:ss and keeps y to one decimal', () => {
        expect(format({ value: 252, axisDimension: 'x' })).toBe('4:12');
        expect(format({ value: 90.6, axisDimension: 'x' })).toBe('1:30');
        expect(format({ value: -90.6, axisDimension: 'x' })).toBe('-1:30');
        expect(format({ value: 168.24, axisDimension: 'y' })).toBe('168.2');
        expect(format({ value: 'nope', axisDimension: 'x' })).toBe('');
    });

    it('uses that formatter for the x and y axis tags', () => {
        const style = buildCrossLineStyle(mockChartColors);
        expect(buildXAxisPointer(style).label.formatter({ value: 252 })).toBe('4:12');
        expect(buildYAxisPointer(style).label.formatter({ value: 168.24 })).toBe('168.2');
    });
});
