import type { CropsterSettingsSnapshot } from '@shared/types/cropster';
import { describe, expect, it } from 'vitest';
import { normalizeRoastSettings } from '../model/settings';
import { cropsterTemperatureUnit, mapCropsterGraphSettings } from './cropster-settings';

const snapshot = (preferences: Record<string, unknown>, sourceVersion = '5.13'): CropsterSettingsSnapshot => ({
    status: 'found',
    source: { product: 'Cropster', version: sourceVersion, sourceId: 'default' },
    machine: null,
    preferences: { version: '5.13', ...preferences },
});

describe('Cropster graph mapping', () => {
    it('maps explicit Celsius axes, time, and RoR time expression', () => {
        const { patch, fields } = mapCropsterGraphSettings(
            snapshot({
                temperatureUnit: 'CELSIUS',
                time: 1020,
                minTemp: 50,
                maxTemp: 250,
                minRiseRate: -5,
                maxRiseRate: 20,
                ror: 60,
                rorSmoothing: 'STANDARD',
                autoDetectionEnabled: false,
            }),
            normalizeRoastSettings({}),
        );
        expect(patch).toEqual({
            temperatureUnit: 'C',
            timeRangeMin: 17,
            timeRangeCustom: true,
            tempMinC: 50,
            tempMaxC: 250,
            rorYMin: -5,
            rorYMax: 20,
        });
        expect(fields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ field: 'ror', target: null, status: 'mapped' }),
                expect.objectContaining({ field: 'rorSmoothing', status: 'unsupported' }),
                expect.objectContaining({ field: 'autoDetectionEnabled', value: false, status: 'unsupported' }),
            ]),
        );
    });

    it('converts Fahrenheit absolute and RoR differential axes to C per minute', () => {
        const { patch } = mapCropsterGraphSettings(
            snapshot({
                temperatureUnit: 'FAHRENHEIT',
                minTemp: 122,
                maxTemp: 482,
                minRiseRate: -10,
                maxRiseRate: 40,
                ror: 30,
            }),
            normalizeRoastSettings({}),
        );
        expect(patch.tempMinC).toBe(50);
        expect(patch.tempMaxC).toBe(250);
        expect(patch.rorYMin).toBeCloseTo(-100 / 9);
        expect(patch.rorYMax).toBeCloseTo(400 / 9);
        expect(['CELSIUS', 'FAHRENHEIT', 'C', null].map(cropsterTemperatureUnit)).toEqual(['C', 'F', null, null]);
    });

    it('does not fill absent values or apply invalid and unverified schemas', () => {
        const previous = normalizeRoastSettings({ tempMinC: 130, tempMaxC: 240 });
        expect(mapCropsterGraphSettings(snapshot({ temperatureUnit: 'CELSIUS' }), previous).patch).toEqual({
            temperatureUnit: 'C',
        });
        const invalid = mapCropsterGraphSettings(
            snapshot({
                temperatureUnit: 'KELVIN',
                time: 61,
                minTemp: 250,
                maxTemp: 50,
                minRiseRate: 1,
                maxRiseRate: 2,
            }),
            previous,
        );
        expect(invalid.patch).toEqual({});
        expect(invalid.fields.every((field) => field.status !== 'mapped')).toBe(true);
        expect(mapCropsterGraphSettings(snapshot({ version: '5.14', temperatureUnit: 'CELSIUS' }), previous)).toEqual({
            patch: {},
            fields: [{ field: 'version', value: '5.14', target: null, status: 'unsupported' }],
        });
        expect(
            mapCropsterGraphSettings(
                {
                    ...snapshot({ temperatureUnit: 'CELSIUS' }),
                    preferences: { temperatureUnit: 'CELSIUS' },
                },
                previous,
            ),
        ).toEqual({
            patch: {},
            fields: [{ field: 'version', value: undefined, target: null, status: 'unsupported' }],
        });
    });
});
