import { describe, expect, it } from 'vitest';
import { layoutMenuBarMetrics, MENU_BAR_HEIGHT } from './menu-bar-metrics';

const measure = (text: string) => text.length;

const layoutOf = (reading: Parameters<typeof layoutMenuBarMetrics>[2]) =>
    layoutMenuBarMetrics(measure, measure, reading);

const glyphsAt = (reading: Parameters<typeof layoutMenuBarMetrics>[2], text: string) =>
    layoutOf(reading).glyphs.filter((glyph) => glyph.text === text);

describe('layoutMenuBarMetrics', () => {
    const reading = { et: '210.2°C', bt: '198.4°C', ror: '12.0', time: '8:42' };

    it('stacks each name over its number and lines the columns up', () => {
        const layout = layoutOf(reading);
        const et = glyphsAt(reading, 'ET')[0];
        const bt = glyphsAt(reading, 'BT')[0];
        const ror = glyphsAt(reading, 'RoR')[0];
        const time = glyphsAt(reading, 'Time')[0];
        const etValue = layout.glyphs.find((glyph) => glyph.text === '210.2°C');
        const btValue = layout.glyphs.find((glyph) => glyph.text === '198.4°C');
        const rorValue = layout.glyphs.find((glyph) => glyph.text === '12.0');
        const timeValue = layout.glyphs.find((glyph) => glyph.text === '8:42');

        expect(et?.x).toBe(etValue?.x);
        expect(bt?.x).toBe(btValue?.x);
        expect(ror?.x).toBe(rorValue?.x);
        expect(time?.x).toBe(timeValue?.x);
        expect(et?.y).toBe(bt?.y);
        expect(etValue && et ? etValue.y : 0).toBeGreaterThan((et?.y ?? 0) + 6);
        expect(etValue?.y).toBe(rorValue?.y);
        expect(bt && et ? bt.x : 0).toBeGreaterThan((et?.x ?? 0) + 'ET'.length);
        expect(ror && bt ? ror.x : 0).toBeGreaterThan(bt?.x ?? 0);
        expect(time && ror ? time.x : 0).toBeGreaterThan(ror?.x ?? 0);
        expect(layout.height).toBe(MENU_BAR_HEIGHT);
    });

    it('starts the next column after the wider of the name and the number', () => {
        const et = glyphsAt(reading, 'ET')[0];
        const bt = glyphsAt(reading, 'BT')[0];
        expect(bt && et ? bt.x - et.x : 0).toBe('210.2°C'.length + 8);
    });

    it('keeps column edges on whole points when font measurements are fractional', () => {
        const layout = layoutMenuBarMetrics(
            () => 11.2,
            () => 45.25,
            reading,
        );

        expect(layout.width % 1).toBe(0);
        expect(layout.glyphs.every((glyph) => Number.isInteger(glyph.x))).toBe(true);
        expect(layout.glyphs[2].x - layout.glyphs[0].x).toBe(46 + 8);
    });
});
