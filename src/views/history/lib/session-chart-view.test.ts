import { savedChartControls } from '@features/active-roast/lib/saved-chart-controls';
import { expect, it } from 'vitest';
import { historyPrintTempBounds } from './session-chart-view';

it('retains recorded gas commands even when the machine did not record feedback', () => {
    const input = {
        points: [{ t: 0, heater: null, fan: null, drum: null }],
        heatSet: [0],
        heatSetUnit: '%',
        referenceControls: false,
        displayedTarget: { xs: [], drum: [], heater: [], fan: [] },
    };
    expect(savedChartControls(input)).toMatchObject({
        hasControls: false,
        controlData: { heatSet: [0], heatSetUnit: '%' },
    });
    expect(savedChartControls({ ...input, heatSet: [null] })).toEqual({ hasControls: false, controlData: undefined });
    expect(
        savedChartControls({ ...input, heatSet: [null], changes: [{ timeSec: 0, values: { fan: 0 } }] }),
    ).toMatchObject({ hasControls: false, controlData: { changes: [{ timeSec: 0, values: { fan: 0 } }] } });
});

it('retains the historical PDF temperature fit including enabled reference samples', () => {
    const points = [{ bt: 95, et: 200 }];
    const target = [{ bt: 400, et: 500 }];
    expect(historyPrintTempBounds(points, target, { bt: true, et: false }, 130, 240)).toEqual({
        tempMinC: 80,
        tempMaxC: 410,
    });
    expect(historyPrintTempBounds(points, target, null, 130, 240)).toEqual({ tempMinC: 80, tempMaxC: 210 });
    expect(points).toEqual([{ bt: 95, et: 200 }]);
});
