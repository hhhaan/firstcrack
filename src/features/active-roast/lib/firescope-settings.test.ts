import type { FirescopeSettingsSnapshot } from '@shared/types/firescope';
import { describe, expect, it } from 'vitest';
import { normalizeRoastSettings } from '../model/settings';
import { firescopeTemperatureUnit, mapFirescopeGraphSettings } from './firescope-settings';

const snapshot = (graph: Record<string, unknown>): FirescopeSettingsSnapshot => ({
    status: 'found',
    source: { product: 'Firescope', version: null },
    graphTemperatureUnit: '°C',
    graph,
    indicator: { rorInterval: 30 },
    global: null,
    machines: [],
});

describe('Firescope graph mapping', () => {
    it('converts Fahrenheit bounds and seconds while activating custom range and preset ticks', () => {
        const previous = normalizeRoastSettings({ timeTickCustom: true });
        const { patch } = mapFirescopeGraphSettings(
            snapshot({ yAxisStart: 122, yAxisEnd: 482, xAxisEnd: 720, xAxisScaleUnit: 60 }),
            previous,
            'F',
        );
        expect(patch).toEqual({
            temperatureUnit: 'F',
            tempMinC: 50,
            tempMaxC: 250,
            timeRangeMin: 12,
            timeRangeCustom: true,
            timeTickIntervalSec: 60,
            timeTickCustom: false,
            timeTickPresetSec: 60,
        });
    });

    it('keeps existing line widths, dash styles and unrelated settings', () => {
        const previous = normalizeRoastSettings({ btSmoothing: 80 });
        previous.curveStyles.bt = { ...previous.curveStyles.bt, width: 3, lineType: 'dashed' };
        const { patch, fields } = mapFirescopeGraphSettings(
            snapshot({
                btLineColor: '#44A56B',
                etLineVisible: false,
                dryingEndTemp: 150,
                event: { fireEventName: 'Gas' },
            }),
            previous,
            'C',
        );
        expect(patch.curveStyles?.bt).toEqual({ ...previous.curveStyles.bt, color: '#44a56b' });
        expect(patch.curveStyles?.et).toEqual(previous.curveStyles.et);
        expect(patch.showET).toBe(false);
        expect(patch).not.toHaveProperty('btSmoothing');
        expect(fields.filter((field) => field.status === 'unsupported').map((field) => field.field)).toEqual([
            'dryingEndTemp',
            'event',
            'indicator.rorInterval',
        ]);
    });

    it('requires a known unit for axis bounds, retaining valid independent colors', () => {
        const { patch, fields } = mapFirescopeGraphSettings(
            snapshot({ yAxisStart: 50, yAxisEnd: 250, btLineColor: '#44a56b' }),
            normalizeRoastSettings({}),
            null,
        );
        expect(patch).not.toHaveProperty('tempMinC');
        expect(patch.curveStyles?.bt.color).toBe('#44a56b');
        expect(fields.find((field) => field.field === 'yAxisStart')?.status).toBe('unsupported');
        expect(['C', '°C', 'F', '°F', '', null, 'Kelvin'].map(firescopeTemperatureUnit)).toEqual([
            'C',
            'C',
            'F',
            'F',
            null,
            null,
            null,
        ]);
    });

    it('rejects invalid bounds, fractional minutes, colors and boolean lookalikes', () => {
        const { patch, fields } = mapFirescopeGraphSettings(
            snapshot({
                yAxisStart: 250,
                yAxisEnd: 50,
                xAxisEnd: 725,
                xAxisScaleUnit: 0,
                btLineColor: 'red',
                etLineVisible: 'false',
            }),
            normalizeRoastSettings({}),
            null,
        );
        expect(patch).toEqual({});
        expect(
            fields.filter((field) => !field.field.startsWith('indicator.')).every((field) => field.status !== 'mapped'),
        ).toBe(true);
    });
});
