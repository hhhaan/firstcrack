// @vitest-environment jsdom
import type { TsvPoint } from '@shared/lib/tsv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SavedRoastCurve } from './SavedRoastCurve';

const mocks = vi.hoisted(() => ({ chart: vi.fn(), unit: 'C' }));
vi.mock('../model/settings', () => ({
    useRoastSettings: () => ({
        temperatureUnit: mocks.unit,
        tempMinC: 130,
        tempMaxC: 240,
        rorYMin: -5,
        rorYMax: 20,
        showET: true,
        showRoRChart: true,
        showRoRET: true,
        showPhaseBar: false,
    }),
}));
vi.mock('./SavedCurveLegend', () => ({ SavedCurveLegend: () => null }));
vi.mock('./RoastTempChart', () => ({
    RoastTempChart: (props: unknown) => {
        mocks.chart(props);
        return null;
    },
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows every saved BT/ET/RoR sample with independent temperature and delta conversion and no write actions', async () => {
    const points: TsvPoint[] = [
        { t: 0, bt: 190, et: 200, ror: -2, rorEt: 3, heater: null, fan: null, drum: null },
        { t: 1, bt: 95, et: null, ror: null, heater: null, fan: null, drum: null },
        { t: 121, bt: 210, et: 230, ror: 10, rorEt: null, heater: null, fan: null, drum: null },
    ];
    const snapshot = structuredClone(points);
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<SavedRoastCurve points={points} />));
    expect(mocks.chart.mock.lastCall?.[0]).toMatchObject({
        xs: [0, 1, 121],
        btActual: [190, 95, 210],
        etActual: [200, null, 230],
        rorActual: [-2, null, 10],
        rorEtActual: [3, null, null],
        tempMinC: 130,
        tempMaxC: 240,
        xViewMin: 0,
        xViewMax: 121,
        showTargetCurve: false,
        showRoRET: true,
    });
    mocks.unit = 'F';
    await act(async () => root.render(<SavedRoastCurve points={points} />));
    expect(mocks.chart.mock.lastCall?.[0]).toMatchObject({
        btActual: [374, 203, 410],
        etActual: [392, null, 446],
        rorActual: [-3.6, null, 18],
        rorEtActual: [5.4, null, null],
    });
    expect(mocks.chart.mock.lastCall?.[0].onEventMarkerEdit).toBeUndefined();
    expect(mocks.chart.mock.lastCall?.[0].onEventMarkerDrag).toBeUndefined();
    expect(points).toEqual(snapshot);
    await act(async () => root.unmount());
});
