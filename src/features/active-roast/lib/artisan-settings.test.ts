import type { ArtisanSettingsSnapshot } from '@shared/types/artisan';
import { describe, expect, it } from 'vitest';
import { normalizeRoastSettings } from '../model/settings';
import { mapArtisanGraphSettings } from './artisan-settings';

const snapshot = (settings: Record<string, unknown>): ArtisanSettingsSnapshot => ({
    status: 'found',
    source: { product: 'Artisan', version: null, sourceId: 'native' },
    settings,
});

describe('Artisan graph mapping', () => {
    it('maps F axes and known colors while preserving all other styles', () => {
        const previous = normalizeRoastSettings({});
        const { patch } = mapArtisanGraphSettings(
            snapshot({
                Mode: 'F',
                'Axis/xmin': 0,
                'Axis/xmax': 720,
                'Axis/ymin': 122,
                'Axis/ymax': 482,
                Colors: { bt: '#44A56B', et: '#112233', canvas: '#ffffff' },
            }),
            previous,
        );
        expect(patch).toMatchObject({ temperatureUnit: 'F', tempMinC: 50, tempMaxC: 250, timeRangeMin: 12 });
        expect(patch.curveStyles?.bt.color).toBe('#44a56b');
        expect(patch.curveStyles?.ror).toEqual(previous.curveStyles.ror);
    });

    it('keeps independent valid colors when ranges are invalid and flags control settings', () => {
        const previous = normalizeRoastSettings({});
        const { patch, fields } = mapArtisanGraphSettings(
            snapshot({
                Mode: 'K',
                'Axis/xmin': 5,
                'Axis/xmax': 721,
                'Axis/ymin': 300,
                'Axis/ymax': 100,
                Colors: { bt: '#abcdef', et: 'red' },
                BTfunction: 'x+1',
                Alarms: [1],
            }),
            previous,
        );
        expect(patch).toEqual({
            curveStyles: { ...previous.curveStyles, bt: { ...previous.curveStyles.bt, color: '#abcdef' } },
        });
        expect(fields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ field: 'Mode', status: 'invalid' }),
                expect.objectContaining({ field: 'Axis/xmax', status: 'invalid' }),
                expect.objectContaining({ field: 'Colors.et', status: 'invalid' }),
                expect.objectContaining({ field: 'BTfunction', status: 'unsupported' }),
            ]),
        );
    });

    it('does not assume an omitted x minimum for an unknown writer version', () => {
        const previous = normalizeRoastSettings({});
        const unknown = mapArtisanGraphSettings(snapshot({ 'Axis/xmax': 720 }), previous);
        expect(unknown.patch).not.toHaveProperty('timeRangeMin');
        expect(unknown.fields).toContainEqual({
            field: 'Axis/xmax',
            value: 720,
            target: 'timeRangeMin',
            status: 'invalid',
        });
        expect(
            mapArtisanGraphSettings(snapshot({ 'Axis/xmin': 0, 'Axis/xmax': 720 }), previous).patch.timeRangeMin,
        ).toBe(12);
    });
});
