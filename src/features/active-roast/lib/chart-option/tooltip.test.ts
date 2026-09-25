import { describe, expect, it } from 'vitest';
import { createAxisTooltipFormatter, lastDrawnSampleSec } from './tooltip';
import type { ResolvedChartColors } from './types';

const colors: ResolvedChartColors = {
    btTarget: '#1',
    btTargetTooltip: '#2',
    btActual: '#3',
    etActual: '#4',
    rorActual: '#5',
    tp: '#6',
    phaseLines: '#7',
    currentTimeLine: '#8',
    nowLabel: '#9',
    gridLine: '#a',
    gridLineMinor: '#b',
    axisLabel: '#c',
    axisPointerLine: '#d',
    tooltipTimeColor: '#e',
    tooltipBg: '#f',
    tooltipBorder: '#10',
    markerLabelColor: '#11',
    phaseBarStroke: '#12',
    phaseBarName: '#13',
    phaseBarDuration: '#14',
    controlDrum: '#15',
    controlHeat: '#16',
    controlHeatArea: '#17',
    controlFan: '#18',
    controlFanArea: '#19',
    eventMark: '#23',
    eventControl: '#24',
    fcBandFill: 'rgba(105,103,225,0.1)',
    bbpFill: '#efeff0',
    targetDeltaWithin: '#20',
    targetDeltaOver: '#21',
    targetDeltaUnder: '#22',
};

const formatterOpts = {
    showET: true,
    showRoR: true,
    showRoRET: false,
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
});
