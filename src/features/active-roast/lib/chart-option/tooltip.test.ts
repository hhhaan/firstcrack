import { describe, expect, it } from 'vitest';
import { mockChartColors as colors } from './chart-colors.fixture';
import { createAxisTooltipFormatter, lastDrawnSampleSec } from './tooltip';

const formatterOpts = {
    showET: true,
    showRoR: true,
    showRoRET: false,
    showControlHeat: true,
    unitLabel: '°C',
    rorUnit: '°C/min',
    colors,
    dataEndSec: 180,
};

describe('lastDrawnSampleSec', () => {
    it('skips trailing empty axis sentinels', () => {
        expect(
            lastDrawnSampleSec(
                [0, 180, 780],
                [
                    [192, 148, null],
                    [220, 215, null],
                ],
            ),
        ).toBe(180);
    });

    it('uses the later of temp and control samples', () => {
        expect(
            lastDrawnSampleSec([0, 60], [[100, null]], {
                xs: [0, 90],
                drumTemp: [50, 50],
                heatPower: [20, 20],
                fanSpeed: [15, 15],
            }),
        ).toBe(90);
    });
});

describe('createAxisTooltipFormatter', () => {
    it('shows the active profile heat target between sparse step events', () => {
        const fmt = createAxisTooltipFormatter({
            ...formatterOpts,
            controlData: {
                xs: [0, 90],
                drumTemp: [50, 50],
                heatPower: [40, 40],
                fanSpeed: [20, 20],
                heatTarget: { xs: [0, 120, 600], values: [80, 60, 60] },
            },
        });
        expect(fmt([{ axisValue: 90, seriesName: 'Heat', value: [90, 40] }])).toContain('Heat target: <span>80%');
    });

    it('hides the profile heat target when the heat series is off', () => {
        const fmt = createAxisTooltipFormatter({
            ...formatterOpts,
            showControlHeat: false,
            controlData: {
                xs: [0, 90],
                drumTemp: [50, 50],
                heatPower: [40, 40],
                fanSpeed: [20, 20],
                heatTarget: { xs: [0, 120, 600], values: [80, 60, 60] },
            },
        });
        const html = fmt([{ axisValue: 90, seriesName: 'Fan', value: [90, 20] }]);
        expect(html).toContain('Fan:');
        expect(html).not.toContain('Heat target');
    });

    it('hides target-only tooltip past the drawn curve', () => {
        const fmt = createAxisTooltipFormatter({ ...formatterOpts, dataEndSec: 71 });
        expect(fmt([{ axisValue: 71, seriesName: 'BT Target', value: [71, 210.1] }])).toBe('');
        expect(
            fmt([
                { axisValue: 120, seriesName: 'BT Target', value: [71, 210.1] },
                { axisValue: 120, seriesName: 'Heat', value: [71, 20] },
            ]),
        ).toBe('');
    });

    it('hides tooltip after the last drawn sample', () => {
        const fmt = createAxisTooltipFormatter(formatterOpts);
        expect(
            fmt([
                { axisValue: 319, seriesName: 'BT Target', value: [319, 168.4] },
                { axisValue: 319, seriesName: 'Heat', value: [319, 20] },
                { axisValue: 319, seriesName: 'Fan', value: [319, 15] },
            ]),
        ).toBe('');
    });

    it('shows tooltip at the last drawn sample', () => {
        const fmt = createAxisTooltipFormatter(formatterOpts);
        const html = fmt([
            { axisValue: 180, seriesName: 'BT Actual', value: [180, 148.7] },
            { axisValue: 180, seriesName: 'BT Target', value: [180, 151] },
        ]);
        expect(html).toContain('3:00');
        expect(html).toContain('Bean Temp');
        expect(html).toContain('Target BT');
    });

    it('shows stored reference channels beside a live sample and not on their own', () => {
        const fmt = createAxisTooltipFormatter(formatterOpts);
        expect(fmt([{ axisValue: 30, seriesName: 'ET Target', value: [30, 110] }])).toBe('');
        const html = fmt([
            { axisValue: 30, seriesName: 'BT Actual', value: [30, 120] },
            { axisValue: 30, seriesName: 'ET Target', value: [30, 110] },
            { axisValue: 30, seriesName: 'RoR Target', value: [30, 6] },
            { axisValue: 30, seriesName: 'Heater Target', value: [30, 60] },
            { axisValue: 30, seriesName: 'Fan Target', value: [30, 0] },
            { axisValue: 30, seriesName: 'Drum Target', value: [30, null] },
        ]);
        expect(html).toContain('Target ET');
        expect(html).toContain('Target RoR');
        expect(html).toContain('Target Heater');
        expect(html).toContain('Target Fan: <span>0%');
        expect(html).not.toContain('Target Drum');
    });
});
