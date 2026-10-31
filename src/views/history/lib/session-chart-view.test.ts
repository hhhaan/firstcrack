import { expect, it } from 'vitest';
import { historyControls } from './session-chart-view';

it('retains recorded gas commands even when the machine did not record feedback', () => {
    const input = {
        points: [{ t: 0, heater: null, fan: null, drum: null }],
        heatSet: [0],
        heatSetUnit: '%',
        referenceControls: false,
        displayedTarget: { xs: [], drum: [], heater: [], fan: [] },
    };
    expect(historyControls(input)).toMatchObject({
        hasControls: false,
        controlData: { heatSet: [0], heatSetUnit: '%' },
    });
    expect(historyControls({ ...input, heatSet: [null] })).toEqual({ hasControls: false, controlData: undefined });
    expect(historyControls({ ...input, heatSet: [null], changes: [{ timeSec: 0, values: { fan: 0 } }] })).toMatchObject(
        { hasControls: false, controlData: { changes: [{ timeSec: 0, values: { fan: 0 } }] } },
    );
});
