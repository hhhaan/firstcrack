import { FEATURE, planHasFeature } from '@shared/lib/features';
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import type { ArtisanSettingsSnapshot } from '@shared/types/artisan';
import type { CropsterSettingsSnapshot } from '@shared/types/cropster';
import type { FirescopeSettingsSnapshot } from '@shared/types/firescope';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CURVE_STYLES } from '../lib/curve-style';
import {
    AUTO_DROP_START_MIN_DEFAULT,
    AUTO_DROP_START_MIN_MAX,
    btSmoothingToAlpha,
    chartSpanSec,
    coercePollIntervalForPlan,
    fontScaleToSlider,
    getRoastSettings,
    normalizeRoastSettings,
    sliderToFontScale,
    updateRoastSettings,
} from './settings';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));

it('drops the combined batch numbering choice', () => {
    expect(normalizeRoastSettings({ batchTitleNumbering: 'both' }).batchTitleNumbering).toBe('profile');
});

it('uses PR as the total-number prefix and drops separators', () => {
    expect(normalizeRoastSettings({}).totalBatchPrefix).toBe('PR');
    expect(normalizeRoastSettings({ totalBatchPrefix: '  LOT# ' }).totalBatchPrefix).toBe('LOT');
    expect(normalizeRoastSettings({ totalBatchPrefix: '' }).totalBatchPrefix).toBe('PR');
});

it('keeps bean names as the default title source and accepts only the profile option', () => {
    expect(normalizeRoastSettings({}).batchTitleSource).toBe('bean');
    expect(normalizeRoastSettings({ batchTitleSource: 'profile' }).batchTitleSource).toBe('profile');
    expect(normalizeRoastSettings({ batchTitleSource: 'invalid' } as never).batchTitleSource).toBe('bean');
});

it('migrates RoR grid settings into the shared grid without activating an inactive number list', () => {
    const migrated = normalizeRoastSettings({
        rorGridInterval: 1,
        rorGridPresetInterval: 10,
        rorAxisMode: 'list',
        rorTickMode: 'list',
        rorTicksC: [-5, 0, 5],
    });
    expect(migrated).toMatchObject({
        horizontalGridInterval: 1,
        horizontalGridPresetInterval: 10,
        horizontalGridMode: 'custom',
        rorTickMode: 'list',
        rorTicksC: [-5, 0, 5],
    });
    expect(migrated).not.toHaveProperty('rorGridInterval');
    expect(migrated).not.toHaveProperty('rorGridPresetInterval');
    expect(migrated).not.toHaveProperty('rorAxisMode');
    expect(normalizeRoastSettings({ ...migrated, horizontalGridMode: 'preset' })).toMatchObject({
        horizontalGridMode: 'preset',
        rorTickMode: 'list',
    });
    expect(
        normalizeRoastSettings({ rorAxisMode: 'preset', rorGridPresetInterval: 10, rorTickMode: 'list' }),
    ).toMatchObject({
        horizontalGridMode: 'preset',
        horizontalGridPresetInterval: 10,
        rorTickMode: 'interval',
    });
});

const firescopeSnapshot: FirescopeSettingsSnapshot = {
    status: 'found',
    source: { product: 'Firescope', version: null },
    graphTemperatureUnit: '°C',
    graph: { yAxisStart: 50, yAxisEnd: 250, btLineColor: '#44a56b' },
    indicator: null,
    global: null,
    machines: [],
};

const artisanSnapshot: ArtisanSettingsSnapshot = {
    status: 'found',
    source: { product: 'Artisan', version: null, sourceId: 'native' },
    settings: { Mode: 'F', 'Axis/ymin': 122, 'Axis/ymax': 482, Colors: { bt: '#44a56b' } },
};

const cropsterSnapshot: CropsterSettingsSnapshot = {
    status: 'found',
    source: { product: 'Cropster', version: '5.13', sourceId: 'default' },
    machine: null,
    preferences: { version: '5.13', temperatureUnit: 'CELSIUS', minTemp: 50, maxTemp: 250, time: 1020 },
};

it('waits for saved settings before importing and persists the merged result across restart', async () => {
    vi.resetModules();
    const stored = normalizeRoastSettings({ btSmoothing: 80 });
    stored.curveStyles.bt = { ...stored.curveStyles.bt, width: 4, lineType: 'dashed' };
    let resolveHydration: (value: typeof stored) => void = () => {};
    vi.mocked(settingsGet).mockReturnValueOnce(
        new Promise((resolve) => {
            resolveHydration = resolve;
        }),
    );
    const settings = await import('./settings');
    const importing = settings.importFirescopeGraphSettings(firescopeSnapshot, 'C');
    resolveHydration(stored);
    await importing;
    expect(settings.getRoastSettings()).toMatchObject({
        tempMinC: 50,
        tempMaxC: 250,
        btSmoothing: 80,
        curveStyles: { bt: { color: '#44a56b', width: 4, lineType: 'dashed' } },
    });
    expect(settingsSet).toHaveBeenLastCalledWith('roast.settings', settings.getRoastSettings(), { throwOnError: true });
    const persisted = structuredClone(settings.getRoastSettings());
    vi.resetModules();
    vi.mocked(settingsGet).mockResolvedValueOnce(persisted);
    const restarted = await import('./settings');
    await Promise.resolve();
    expect(restarted.getRoastSettings()).toEqual(persisted);
});

it.each(['Firescope', 'Artisan', 'Cropster'] as const)(
    'keeps current graph settings when %s import persistence fails',
    async (product) => {
        vi.resetModules();
        vi.mocked(settingsGet).mockResolvedValueOnce({ tempMinC: 130, btSmoothing: 80 });
        const settings = await import('./settings');
        await Promise.resolve();
        const previous = settings.getRoastSettings();
        vi.mocked(settingsSet).mockRejectedValueOnce(new Error('disk full'));
        const importing =
            product === 'Firescope'
                ? settings.importFirescopeGraphSettings(firescopeSnapshot, 'C')
                : product === 'Artisan'
                  ? settings.importArtisanGraphSettings(artisanSnapshot)
                  : settings.importCropsterGraphSettings(cropsterSnapshot);
        await expect(importing).rejects.toThrow('disk full');
        expect(settings.getRoastSettings()).toBe(previous);
    },
);

it('persists Artisan graph fields without replacing unrelated settings', async () => {
    vi.resetModules();
    vi.mocked(settingsGet).mockResolvedValueOnce({ btSmoothing: 80 });
    const settings = await import('./settings');
    await settings.importArtisanGraphSettings(artisanSnapshot);
    expect(settings.getRoastSettings()).toMatchObject({
        temperatureUnit: 'F',
        tempMinC: 50,
        tempMaxC: 250,
        btSmoothing: 80,
        curveStyles: { bt: { color: '#44a56b' } },
    });
    expect(settingsSet).toHaveBeenLastCalledWith('roast.settings', settings.getRoastSettings(), { throwOnError: true });
});

it('persists Cropster graph fields without replacing unrelated settings', async () => {
    vi.resetModules();
    vi.mocked(settingsGet).mockResolvedValueOnce({ btSmoothing: 80 });
    const settings = await import('./settings');
    await settings.importCropsterGraphSettings(cropsterSnapshot);
    expect(settings.getRoastSettings()).toMatchObject({
        temperatureUnit: 'C',
        tempMinC: 50,
        tempMaxC: 250,
        timeRangeMin: 17,
        btSmoothing: 80,
    });
    expect(settingsSet).toHaveBeenLastCalledWith('roast.settings', settings.getRoastSettings(), { throwOnError: true });
});

it('restores and bounds display smoothing while preserving the original default', async () => {
    expect(normalizeRoastSettings({}).btSmoothing).toBe(0);
    expect(normalizeRoastSettings({}).etSmoothing).toBe(0);
    expect(normalizeRoastSettings({}).rorSmoothing).toBe(0);
    expect(normalizeRoastSettings({}).etRorSmoothing).toBe(0);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, '80', null]) {
        const normalized = normalizeRoastSettings({
            btSmoothing: invalid,
            etSmoothing: invalid,
        } as Partial<ReturnType<typeof getRoastSettings>>);
        expect(normalized.btSmoothing).toBe(0);
        expect(normalized.etSmoothing).toBe(0);
        expect(normalized.rorSmoothing).toBe(0);
        expect(normalized.etRorSmoothing).toBe(0);
    }
    expect(normalizeRoastSettings({ btSmoothing: -1, etSmoothing: -1 }).etSmoothing).toBe(0);
    expect(normalizeRoastSettings({ btSmoothing: 101, etSmoothing: 101 }).etSmoothing).toBe(100);
    expect(normalizeRoastSettings({ btSmoothing: 74.6, etSmoothing: 74.6 }).etSmoothing).toBe(75);
    expect(normalizeRoastSettings({ btSmoothing: -1 }).btSmoothing).toBe(0);
    expect(normalizeRoastSettings({ btSmoothing: 101 }).btSmoothing).toBe(100);
    expect(normalizeRoastSettings({ btSmoothing: 74.6 }).btSmoothing).toBe(75);
    expect(normalizeRoastSettings({ rorSmoothing: -1, etRorSmoothing: 101 }).rorSmoothing).toBe(0);
    expect(normalizeRoastSettings({ rorSmoothing: -1, etRorSmoothing: 101 }).etRorSmoothing).toBe(100);
    expect(normalizeRoastSettings({ rorSmoothing: 43.6 }).rorSmoothing).toBe(44);
    expect([0, 50, 100].map(btSmoothingToAlpha)).toEqual([1, 0.16, 0.08]);

    vi.resetModules();
    vi.mocked(settingsGet).mockResolvedValueOnce({ btSmoothing: 75 });
    const settings = await import('./settings');
    await Promise.resolve();
    expect(settings.getRoastSettings().btSmoothing).toBe(75);
    expect(settings.getRoastSettings().etSmoothing).toBe(0);
    settings.updateRoastSettings({ etSmoothing: 100 });
    expect(settingsSet).toHaveBeenCalledWith(
        'roast.settings',
        expect.objectContaining({ btSmoothing: 75, etSmoothing: 100 }),
        { debounce: true },
    );
});

it('validates direct number intervals and restores persisted choices', async () => {
    const defaults = {
        tempLabelInterval: 50,
        rorLabelInterval: 5,
        timeTickIntervalSec: 60,
        tempTicksC: [],
        tempTickMode: 'interval',
    };
    const choices = {
        tempLabelInterval: 60,
        rorLabelInterval: 8,
        timeTickIntervalSec: 120,
        tempTicksC: [100, 180, 200],
        tempTickMode: 'list' as const,
    };
    expect(normalizeRoastSettings({})).toMatchObject(defaults);
    const previous = normalizeRoastSettings(choices);
    for (const invalid of [-1, 0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '10', null]) {
        expect(
            normalizeRoastSettings(
                Object.fromEntries([
                    ['tempLabelInterval', invalid],
                    ['timeTickIntervalSec', invalid],
                    ['tempTicksC', [Number.NaN]],
                ]),
            ),
        ).toMatchObject({ tempLabelInterval: 50, timeTickIntervalSec: 60, tempTicksC: [] });
        expect(
            normalizeRoastSettings(
                Object.fromEntries([
                    ['tempLabelInterval', invalid],
                    ['timeTickIntervalSec', invalid],
                ]),
                previous,
            ),
        ).toMatchObject({ tempLabelInterval: 60, timeTickIntervalSec: 120 });
    }
    expect(normalizeRoastSettings({ tempLabelInterval: 2.5, tempTicksC: [200, 100, 100, 180] })).toMatchObject({
        tempLabelInterval: 2.5,
        tempTicksC: [100, 180, 200],
    });
    expect(normalizeRoastSettings({ tempLabelInterval: 250001 })).toMatchObject({ tempLabelInterval: 50 });
    expect(normalizeRoastSettings({ rorLabelInterval: Number.NaN }, previous).rorLabelInterval).toBe(8);
    expect(normalizeRoastSettings({ temperatureUnit: 'F', rorLabelInterval: 5 / 9 }).rorLabelInterval).toBeCloseTo(
        5 / 9,
    );
    expect(chartSpanSec(normalizeRoastSettings({}))).toBe(780);
    expect(chartSpanSec(normalizeRoastSettings({ timeRangePresetMin: 20 }))).toBe(1200);
    expect(chartSpanSec(normalizeRoastSettings({ timeRangeCustom: true, timeRangeMin: 20 }))).toBe(1200);
    expect(normalizeRoastSettings({ timeRangePresetMin: 99, timeRangeMin: 0 })).toMatchObject({
        timeRangePresetMin: 13,
        timeRangeMin: 13,
        timeRangeCustom: false,
    });
    expect(normalizeRoastSettings({}).horizontalGridMode).toBe('preset');
    expect(normalizeRoastSettings({ horizontalGridInterval: 15 })).toMatchObject({
        horizontalGridMode: 'custom',
        horizontalGridInterval: 15,
    });
    for (const interval of [1, 2, 3, 4, 5, 6, 8])
        expect(normalizeRoastSettings({ horizontalGridInterval: interval }).horizontalGridInterval).toBe(interval);
    expect(normalizeRoastSettings({ horizontalGridInterval: 0.1 }).horizontalGridInterval).toBe(1);
    expect(normalizeRoastSettings({ horizontalGridPresetInterval: 1 }).horizontalGridPresetInterval).toBe(5);
    expect(normalizeRoastSettings({ horizontalGridPresetInterval: 2 }).horizontalGridPresetInterval).toBe(5);
    expect(normalizeRoastSettings({ horizontalGridInterval: 250 }).horizontalGridInterval).toBe(100);
    expect(
        normalizeRoastSettings({ temperatureUnit: 'F', horizontalGridInterval: 0.1 }).horizontalGridInterval,
    ).toBeCloseTo(5 / 9);
    expect(
        normalizeRoastSettings({ temperatureUnit: 'F', horizontalGridInterval: 50 / 9 }).horizontalGridInterval,
    ).toBeCloseTo(50 / 9);
    expect(normalizeRoastSettings({ rorTicksC: [10, -5, 0, 0] }).rorTicksC).toEqual([-5, 0, 10]);
    expect(normalizeRoastSettings({ rorTicksC: [301] }).rorTicksC).toEqual([]);
    vi.resetModules();
    vi.mocked(settingsGet).mockResolvedValueOnce(choices);
    const settings = await import('./settings');
    await Promise.resolve();
    expect(settings.getRoastSettings()).toMatchObject(choices);
    settings.updateRoastSettings({ timeTickIntervalSec: 30 });
    expect(settingsSet).toHaveBeenLastCalledWith(
        'roast.settings',
        expect.objectContaining({ ...choices, timeTickIntervalSec: 30 }),
        { debounce: true },
    );
});

it('migrates active grid-times-frequency choices into independent number spacing', () => {
    const migrated = normalizeRoastSettings({
        tempAxisMode: 'list',
        tempTickMode: 'interval',
        tempGridInterval: 10,
        tempLabelCustom: true,
        tempLabelEvery: 5,
        horizontalGridMode: 'custom',
        horizontalGridInterval: 1,
        rorLabelCustom: true,
        rorLabelEvery: 2,
    });
    expect(migrated).toMatchObject({ tempLabelInterval: 50, rorLabelInterval: 2 });
    for (const retired of [
        'tempGridInterval',
        'tempGridPresetInterval',
        'tempLabelEvery',
        'tempLabelPresetEvery',
        'tempAxisMode',
        'tempLabelCustom',
        'rorLabelEvery',
        'rorLabelPresetEvery',
        'rorLabelCustom',
    ])
        expect(migrated).not.toHaveProperty(retired);
    expect(normalizeRoastSettings({ ...migrated, horizontalGridInterval: 5 })).toMatchObject({
        tempLabelInterval: 50,
        rorLabelInterval: 2,
    });
    expect(normalizeRoastSettings(migrated)).toEqual(migrated);
    expect(
        normalizeRoastSettings({
            tempAxisMode: 'preset',
            tempTickMode: 'list',
            tempTicksC: [100, 180],
            tempGridPresetInterval: 20,
            tempLabelPresetEvery: 3,
        }),
    ).toMatchObject({ tempLabelInterval: 60, tempTickMode: 'interval', tempTicksC: [100, 180] });
    expect(
        normalizeRoastSettings({
            tempAxisMode: 'list',
            tempTickMode: 'list',
            tempGridInterval: 30,
            tempLabelCustom: true,
            tempLabelEvery: 3,
            tempTicksC: [100, 180],
        }),
    ).toMatchObject({ tempLabelInterval: 90, tempTickMode: 'list', tempTicksC: [100, 180] });
    expect(
        normalizeRoastSettings({
            temperatureUnit: 'F',
            tempAxisMode: 'preset',
            tempGridPresetInterval: 20,
            tempLabelPresetEvery: 2,
            horizontalGridMode: 'preset',
            horizontalGridPresetInterval: 5,
            rorLabelPresetEvery: 2,
        }),
    ).toMatchObject({ tempLabelInterval: 40, rorLabelInterval: 10 });
});

it('이전에 저장된 BBP 기록 범위는 켜기/끄기 외에 영향을 주지 않는다', () => {
    const stored = { bbpEnabled: false, bbpWindowMinutes: 5 };
    const zero = { bbpEnabled: true, bbpWindowMinutes: 0 };
    const huge = { bbpEnabled: true, bbpWindowMinutes: 100 };
    const settings = normalizeRoastSettings(stored);
    expect(settings.bbpEnabled).toBe(false);
    expect(settings).not.toHaveProperty('bbpWindowMinutes');
    expect(normalizeRoastSettings(zero).bbpEnabled).toBe(true);
    expect(normalizeRoastSettings(zero)).not.toHaveProperty('bbpWindowMinutes');
    expect(normalizeRoastSettings(huge)).not.toHaveProperty('bbpWindowMinutes');
});

it('defaults the poll interval to 1s and keeps a stored 500ms choice', () => {
    expect(normalizeRoastSettings({}).pollIntervalMs).toBe(1000);
    expect(normalizeRoastSettings({ pollIntervalMs: 500 }).pollIntervalMs).toBe(500);
});

describe('coercePollIntervalForPlan', () => {
    it('coerces stored 500ms to 1s when the plan lacks fast polling', () => {
        expect(coercePollIntervalForPlan(500, false)).toBe(1000);
    });

    it('keeps 500ms for entitled plans', () => {
        expect(coercePollIntervalForPlan(500, true)).toBe(500);
    });

    it('never touches 1s', () => {
        expect(coercePollIntervalForPlan(1000, false)).toBe(1000);
        expect(coercePollIntervalForPlan(1000, true)).toBe(1000);
    });
});

describe('normalize — phase temperatures', () => {
    it('clamps out-of-range yellow temp', () => {
        expect(normalizeRoastSettings({ yellowTempC: 400 })).toMatchObject({ yellowTempC: 300 });
        expect(normalizeRoastSettings({ yellowTempC: 10 })).toMatchObject({ yellowTempC: 50 });
    });

    it('keeps a valid yellow temp', () => {
        expect(normalizeRoastSettings({ yellowTempC: 160 })).toMatchObject({ yellowTempC: 160 });
    });

    it('defaults fcDualMarkEnabled to false', () => {
        expect(normalizeRoastSettings({})).toMatchObject({ fcDualMarkEnabled: false });
    });

    it('normalizes fcDualMarkEnabled boolean', () => {
        expect(normalizeRoastSettings({ fcDualMarkEnabled: true })).toMatchObject({ fcDualMarkEnabled: true });
        expect(normalizeRoastSettings({ fcDualMarkEnabled: false })).toMatchObject({ fcDualMarkEnabled: false });
    });

    it('defaults dual mark when only legacy FC auto keys are present', () => {
        const s = normalizeRoastSettings({
            // legacy store may still hold these; typed settings no longer include them
            autoFcStartEnabled: true,
            fcStartTempC: 195,
        } as Partial<import('./settings').RoastSettings>);
        expect(s.fcDualMarkEnabled).toBe(false);
        expect(s.autoYellowEnabled).toBe(true);
    });
});

describe('normalize — time alerts', () => {
    it('defaults time alarms off with Cropster 3.1 minute values', () => {
        expect(normalizeRoastSettings({})).toMatchObject({
            alertAfterChargeEnabled: false,
            alertAfterChargeMin: 5,
            alertBeforeFcEnabled: false,
            alertBeforeFcMin: 1,
            alertBeforeDropEnabled: false,
            alertBeforeDropMin: 1,
            alertAfterDropEnabled: false,
            alertAfterDropMin: 5,
        });
    });

    it('clamps time-alarm minutes to 1–30', () => {
        expect(normalizeRoastSettings({ alertAfterChargeMin: 0 }).alertAfterChargeMin).toBe(1);
        expect(normalizeRoastSettings({ alertBeforeFcMin: 99 }).alertBeforeFcMin).toBe(30);
    });
});

describe('normalize — alert sound kind', () => {
    it('defaults alertSoundKind to pulse', () => {
        expect(normalizeRoastSettings({})).toMatchObject({ alertSoundKind: 'pulse' });
    });

    it('keeps a known kind and falls back to pulse on an unknown one', () => {
        expect(normalizeRoastSettings({ alertSoundKind: 'kalimba' })).toMatchObject({ alertSoundKind: 'kalimba' });
        expect(normalizeRoastSettings({ alertSoundKind: 'siren' } as never)).toMatchObject({ alertSoundKind: 'pulse' });
    });
});

describe('normalize — profile channels', () => {
    it('shows every stored profile channel when the keys are missing', () => {
        expect(normalizeRoastSettings({})).toMatchObject({
            showProfileBt: true,
            showProfileEt: true,
            showProfileRor: true,
            showProfileEtRor: true,
            showProfileDrum: true,
            showProfileHeat: true,
            showProfileFan: true,
        });
    });

    it('keeps a stored profile channel off', () => {
        expect(normalizeRoastSettings({ showProfileEt: false, showProfileHeat: false })).toMatchObject({
            showProfileEt: false,
            showProfileHeat: false,
            showProfileBt: true,
        });
    });
});

describe('normalize — font scale', () => {
    it('defaults missing and invalid values to slider 1% (1×)', () => {
        expect(normalizeRoastSettings({}).fontScalePct).toBe(100);
        for (const fontScalePct of [0, 99, 110.5, 201, Number.NaN, Number.POSITIVE_INFINITY, '125', null]) {
            expect(normalizeRoastSettings({ fontScalePct } as never).fontScalePct).toBe(100);
        }
    });

    it('maps the 1–100 slider onto stored 100–200 and back', () => {
        expect(fontScaleToSlider(100)).toBe(1);
        expect(fontScaleToSlider(200)).toBe(100);
        expect(sliderToFontScale(1)).toBe(100);
        expect(sliderToFontScale(100)).toBe(200);
        for (let slider = 1; slider <= 100; slider++) {
            expect(fontScaleToSlider(sliderToFontScale(slider))).toBe(slider);
        }
    });

    it('accepts every integer percentage from 100 to 200', () => {
        for (let fontScalePct = 100; fontScalePct <= 200; fontScalePct++) {
            expect(normalizeRoastSettings({ fontScalePct }).fontScalePct).toBe(fontScalePct);
        }
    });

    it.each([100, 101, 113, 125, 150, 175, 199, 200])(
        'restores and saves %s%% through roast.settings',
        async (fontScalePct) => {
            vi.resetModules();
            vi.mocked(settingsGet).mockResolvedValueOnce({ fontScalePct });
            const settings = await import('./settings');
            expect(settings.getRoastSettings().fontScalePct).toBe(fontScalePct);
            expect(settingsGet).toHaveBeenLastCalledWith('roast.settings');
            settings.updateRoastSettings({ fontScalePct });
            expect(settingsSet).toHaveBeenLastCalledWith('roast.settings', expect.objectContaining({ fontScalePct }), {
                debounce: true,
            });
        },
    );
});

describe('normalize — event buttons', () => {
    it('shows the three built-in buttons when the store has no event buttons', () => {
        expect(normalizeRoastSettings({}).eventButtons).toEqual({
            yellow: true,
            fcStart: true,
            fcEnd: true,
            custom: [],
        });
    });

    it('keeps a hidden color-change button', () => {
        expect(
            normalizeRoastSettings({
                eventButtons: { yellow: false, fcStart: true, fcEnd: true, custom: [] },
            }).eventButtons.yellow,
        ).toBe(false);
    });
});

describe('normalize — event marker style', () => {
    it('defaults missing and invalid values to line', () => {
        expect(normalizeRoastSettings({}).eventMarkerStyle).toBe('line');
        expect(normalizeRoastSettings({ eventMarkerStyle: 'unknown' as never }).eventMarkerStyle).toBe('line');
    });

    it('maps the removed both style onto line', () => {
        expect(normalizeRoastSettings({ eventMarkerStyle: 'both' as never }).eventMarkerStyle).toBe('line');
    });

    it.each(['point', 'line', 'tempLine', 'callout'] as const)('preserves stored %s mode', (eventMarkerStyle) => {
        expect(normalizeRoastSettings({ eventMarkerStyle }).eventMarkerStyle).toBe(eventMarkerStyle);
    });
});

describe('FEATURE.fastPolling plan matrix', () => {
    it('grants Pro core level (trial runs at Pro)', () => {
        for (const plan of ['trial', 'pro', 'pro_plus', 'enterprise', 'team']) {
            expect(planHasFeature(plan, FEATURE.fastPolling)).toBe(true);
        }
    });

    it('denies free / read_only / unresolved placeholder', () => {
        for (const plan of ['free', 'read_only', '']) {
            expect(planHasFeature(plan, FEATURE.fastPolling)).toBe(false);
        }
    });
});

describe('normalize — auto drop start minute', () => {
    it('reads a missing field as 7 minutes', () => {
        expect(normalizeRoastSettings({}).autoDropStartMin).toBe(AUTO_DROP_START_MIN_DEFAULT);
        expect(normalizeRoastSettings({ autoDropEnabled: false }).autoDropStartMin).toBe(7);
    });

    it('keeps a positive value and clamps it to 1–30 like the other minute inputs', () => {
        expect(normalizeRoastSettings({ autoDropStartMin: 3 }).autoDropStartMin).toBe(3);
        expect(normalizeRoastSettings({ autoDropStartMin: 3.5 }).autoDropStartMin).toBe(3.5);
        expect(normalizeRoastSettings({ autoDropStartMin: 0.2 }).autoDropStartMin).toBe(1);
        expect(normalizeRoastSettings({ autoDropStartMin: 99 }).autoDropStartMin).toBe(AUTO_DROP_START_MIN_MAX);
    });

    it('restores the previous valid minute, or 7, for non-positive and non-numeric values', () => {
        const previous = normalizeRoastSettings({ autoDropStartMin: 3 });
        for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            expect(normalizeRoastSettings({ autoDropStartMin: bad }, previous).autoDropStartMin).toBe(3);
        }
        expect(normalizeRoastSettings({ autoDropStartMin: '7' } as never, previous).autoDropStartMin).toBe(3);
        expect(normalizeRoastSettings({ autoDropStartMin: 0 }).autoDropStartMin).toBe(7);
        expect(normalizeRoastSettings({ autoDropStartMin: Number.NaN }).autoDropStartMin).toBe(7);
        expect(normalizeRoastSettings({ autoDropStartMin: '3' } as never).autoDropStartMin).toBe(7);
    });

    it('keeps the previous minute when an update patch is invalid', () => {
        updateRoastSettings({ autoDropStartMin: 4 });
        try {
            updateRoastSettings({ autoDropStartMin: 0 });
            updateRoastSettings({ autoDropStartMin: Number.NaN });
            expect(getRoastSettings().autoDropStartMin).toBe(4);
        } finally {
            updateRoastSettings({ autoDropStartMin: AUTO_DROP_START_MIN_DEFAULT });
        }
    });
});

it('defaults legacy Charge/Drop thresholds to Standard and ignores stored °C values', () => {
    const legacy = { yellowTempC: 150, autoChargeDropC: 7, autoDropDropC: 12 };
    expect(normalizeRoastSettings(legacy)).toMatchObject({
        autoChargeEnabled: true,
        autoChargeMode: 'standard',
        autoDropEnabled: true,
        autoDropMode: 'standard',
    });
    const normalizedLegacy = normalizeRoastSettings(legacy);
    expect(normalizedLegacy).not.toHaveProperty('autoChargeDropC');
    expect(normalizedLegacy).not.toHaveProperty('autoDropDropC');
    const storedConfirm = normalizeRoastSettings({ autoChargeConfirmC: 8, autoDropConfirmC: 4 } as never);
    expect(storedConfirm).not.toHaveProperty('autoChargeConfirmC');
    expect(storedConfirm).not.toHaveProperty('autoDropConfirmC');
    expect(normalizeRoastSettings({ autoChargeEnabled: false, autoChargeMode: 'sensitive' })).toMatchObject({
        autoChargeEnabled: false,
        autoChargeMode: 'sensitive',
    });
    expect(normalizeRoastSettings({ autoDropEnabled: false, autoDropMode: 'sensitive' })).toMatchObject({
        autoDropEnabled: false,
        autoDropMode: 'sensitive',
    });
    expect(normalizeRoastSettings({ autoChargeEnabled: 'false', autoChargeMode: 'invalid' } as never)).toMatchObject({
        autoChargeEnabled: true,
        autoChargeMode: 'standard',
    });
    expect(normalizeRoastSettings({ autoDropEnabled: 'false', autoDropMode: 'invalid' } as never)).toMatchObject({
        autoDropEnabled: true,
        autoDropMode: 'standard',
    });
    expect(normalizeRoastSettings({}).replayOnCharge).toBe(false);
    expect(normalizeRoastSettings({ replayOnCharge: true }).replayOnCharge).toBe(true);
});

describe('curve styles', () => {
    it('falls back to defaults for old or invalid stored styles', () => {
        expect(normalizeRoastSettings({}).curveStyles).toEqual(DEFAULT_CURVE_STYLES);
        const stored = normalizeRoastSettings({ curveStyles: { bt: { color: 'nope', width: 50 } } } as never);
        expect(stored.curveStyles.bt).toEqual(DEFAULT_CURVE_STYLES.bt);
    });

    it('updates one channel, survives a restart, and resets to defaults', async () => {
        vi.resetModules();
        vi.mocked(settingsSet).mockClear();
        const first = await import('./settings');
        await Promise.resolve();
        first.updateCurveStyle('bt', { color: '#ff0000' });
        first.updateCurveStyle('ror', { backgroundLineType: 'solid', backgroundWidth: 3 });
        const afterChange = first.getRoastSettings().curveStyles;
        expect(afterChange.bt).toEqual({ ...DEFAULT_CURVE_STYLES.bt, color: '#ff0000' });
        expect(afterChange.ror).toEqual({
            ...DEFAULT_CURVE_STYLES.ror,
            backgroundLineType: 'solid',
            backgroundWidth: 3,
        });
        expect(afterChange.et).toEqual(DEFAULT_CURVE_STYLES.et);
        const persisted = vi.mocked(settingsSet).mock.lastCall?.[1] as ReturnType<typeof getRoastSettings>;
        expect(persisted.curveStyles).toEqual(afterChange);

        vi.resetModules();
        vi.mocked(settingsGet).mockResolvedValueOnce(structuredClone(persisted));
        const restarted = await import('./settings');
        await Promise.resolve();
        expect(restarted.getRoastSettings().curveStyles).toEqual(afterChange);

        restarted.resetCurveStyles();
        expect(restarted.getRoastSettings().curveStyles).toEqual(DEFAULT_CURVE_STYLES);
        expect(restarted.getRoastSettings().temperatureUnit).toBe(persisted.temperatureUnit);
    });
});

it('persists and restores both log panel states', async () => {
    expect(normalizeRoastSettings({}).logExpanded).toBe(false);
    for (const logExpanded of [true, false]) {
        vi.resetModules();
        vi.mocked(settingsGet).mockResolvedValueOnce({ logExpanded });
        const settings = await import('./settings');
        await Promise.resolve();
        expect(settings.getRoastSettings().logExpanded).toBe(logExpanded);
        settings.updateRoastSettings({ logExpanded: !logExpanded });
        expect(settingsSet).toHaveBeenLastCalledWith(
            'roast.settings',
            expect.objectContaining({ logExpanded: !logExpanded }),
            { debounce: true },
        );
    }
});

it('defaults to separated controls and persists the merged chart preference', () => {
    expect(normalizeRoastSettings({}).mergeControlChart).toBe(false);
    expect(normalizeRoastSettings({ mergeControlChart: 'true' } as never).mergeControlChart).toBe(false);
    const original = getRoastSettings();
    try {
        updateRoastSettings({ mergeControlChart: true });
        expect(getRoastSettings().mergeControlChart).toBe(true);
        expect(settingsSet).toHaveBeenLastCalledWith(
            'roast.settings',
            expect.objectContaining({ mergeControlChart: true }),
            { debounce: true },
        );
    } finally {
        updateRoastSettings(original);
    }
});
