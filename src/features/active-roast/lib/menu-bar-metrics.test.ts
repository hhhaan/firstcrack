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

    it('leaves a gap after each reserved column', () => {
        const et = glyphsAt(reading, 'ET')[0];
        const bt = glyphsAt(reading, 'BT')[0];
        expect(bt && et ? bt.x - et.x : 0).toBe('-999.9°F'.length + 12);
        const ror = glyphsAt(reading, 'RoR')[0];
        const time = glyphsAt(reading, 'Time')[0];
        expect(time.x - ror.x).toBe('99.9'.length + 12);
        expect(time.width).toBe('99:59'.length);
    });

    it.each([
        { et: '—', bt: '—', ror: '0.0', time: '0:00' },
        { et: '99.9°C', bt: '-9.9°C', ror: '-9.9', time: '9:59' },
        { et: '100.0°C', bt: '111.1°C', ror: '10.0', time: '10:00' },
        { et: '-999.9°F', bt: '999.9°F', ror: '-999.9', time: '999:59' },
        { et: '-1234.5°F', bt: '1234.5°F', ror: '-1234.5', time: '1000:00' },
    ])('keeps column positions and total width fixed for %j', (next) => {
        const before = layoutOf(reading);
        const after = layoutOf(next);

        expect(after.width).toBe(before.width);
        expect(after.glyphs.map(({ x, width }) => ({ x, width }))).toEqual(
            before.glyphs.map(({ x, width }) => ({ x, width })),
        );
    });

    it('keeps column edges on whole points when font measurements are fractional', () => {
        const layout = layoutMenuBarMetrics(
            () => 11.2,
            () => 45.25,
            reading,
        );

        expect(layout.width % 1).toBe(0);
        expect(layout.glyphs.every((glyph) => Number.isInteger(glyph.x))).toBe(true);
        expect(layout.glyphs[2].x - layout.glyphs[0].x).toBe(46 + 12);
    });
});
