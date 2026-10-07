import { getResolvedChartColors } from '@features/active-roast/lib/chart-config';
import { getRoastSettings, resetCurveStyles, updateCurveStyle } from '@features/active-roast/model/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { historyPdfLegend } from './historyPdfLegend';

vi.mock('@features/active-roast/lib/chart-config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@features/active-roast/lib/chart-config')>();
    return {
        ...actual,
        getResolvedChartColors: vi.fn(() => ({
            btActual: '#bt-live',
            btTarget: '#bt-ref',
            etActual: '#et-live',
            etTarget: '#et-ref',
            rorActual: '#ror-live',
            rorTarget: '#ror-ref',
            controlDrum: '#drum-live',
            controlDrumTarget: '#drum-ref',
            controlHeat: '#heat-live',
            controlHeatTarget: '#heat-ref',
            controlFan: '#fan-live',
            controlFanTarget: '#fan-ref',
        })),
    };
});

describe('historyPdfLegend', () => {
    beforeEach(() => {
        vi.mocked(getResolvedChartColors).mockClear();
        resetCurveStyles();
        updateCurveStyle('heat', {
            color: '#aa4400',
            lineType: 'dotted',
            width: 2,
            backgroundWidth: 2,
            backgroundLineType: 'dashed',
        });
    });

    it('uses resolved curve styles so legend matches the chart image', () => {
        updateCurveStyle('bt', { color: '#e53935' });
        const items = historyPdfLegend({
            unit: 'F',
            hasTarget: true,
            hasControls: true,
            t: (key) => key,
        });
        expect(items).toEqual([
            { color: '#e53935', label: 'BT (°F)', lineType: 'solid' },
            { color: '#et-live', label: 'ET (°F)', lineType: 'solid' },
            { color: '#ror-live', label: 'RoR (°F/min)', lineType: 'solid' },
            { color: '#e539358c', label: 'settings.tabs.roast.showTargetCurve', lineType: 'dashed' },
            { color: '#drum-live', label: 'Drum', lineType: 'solid' },
            { color: '#aa4400', label: 'Heat', lineType: 'solid' },
            { color: '#fan-live', label: 'Fan', lineType: 'solid' },
        ]);
        expect(getRoastSettings().curveStyles.heat.lineType).toBe('solid');
    });
});
