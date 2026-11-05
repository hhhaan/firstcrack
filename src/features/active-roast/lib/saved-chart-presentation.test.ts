import { expect, it } from 'vitest';
import type { RoastSettings } from '../model/settings';
import { savedChartPresentation, savedControlsVisible, savedSensorChannels } from './saved-chart-presentation';

const settings = {
    temperatureUnit: 'F',
    tempMinC: 130,
    tempMaxC: 240,
    rorYMin: 0,
    rorYMax: 15,
    showET: false,
    showRoRChart: false,
    showRoRET: true,
    showControlChart: true,
    showControlHeat: false,
    showControlFan: true,
    showControlDrum: false,
    showProfileHeat: true,
    showProfileFan: false,
    showProfileDrum: false,
    mergeControlChart: true,
    controlChartHeightPct: 35,
    controlYMin: 10,
    controlYMax: 80,
    showFcBand: false,
} as RoastSettings;

it('maps the current saved display ranges and controls without fitting them to samples', () => {
    expect(savedChartPresentation(settings)).toMatchObject({
        temperatureUnit: 'F',
        tempMinC: 130,
        tempMaxC: 240,
        rorYMin: 0,
        rorYMax: 15,
        showET: false,
        showRoR: false,
        showRoRET: true,
        mergeControlChart: true,
        controlChartHeightPct: 35,
        controlYMin: 10,
        controlYMax: 80,
        showControlHeat: false,
        showFcBand: false,
    });
});

it('lists only enabled, populated sensor channels and keeps legacy ET RoR absent', () => {
    const points = [
        { bt: 95, et: 200, ror: -2, rorEt: 3 },
        { bt: 210, et: null, ror: null },
    ];
    expect(savedSensorChannels(points, settings).map((channel) => channel.label)).toEqual([
        'BT · °F',
        'ET RoR · °F/min',
    ]);
    expect(savedSensorChannels([{ bt: 95, et: 200, ror: -2 }], settings).map((channel) => channel.key)).toEqual(['bt']);
});

it('reserves controls only for visible measurements, commands or selected reference channels', () => {
    const data = { xs: [0], heatPower: [30], fanSpeed: [null], drumTemp: [60] };
    expect(savedControlsVisible(data, settings, false)).toBe(false);
    expect(savedControlsVisible({ ...data, fanSpeed: [0] }, settings, false)).toBe(true);
    expect(savedControlsVisible({ ...data, changes: [{ timeSec: 0, values: { fan: 0 } }] }, settings, false)).toBe(
        true,
    );
    expect(savedControlsVisible({ ...data, fanSpeed: [0] }, { ...settings, showControlChart: false }, false)).toBe(
        false,
    );
    const reference = { xs: [0], heater: [30], fan: [null], drum: [null] };
    expect(savedControlsVisible({ ...data, reference }, settings, false)).toBe(false);
    expect(savedControlsVisible({ ...data, reference }, settings, true)).toBe(true);
});
