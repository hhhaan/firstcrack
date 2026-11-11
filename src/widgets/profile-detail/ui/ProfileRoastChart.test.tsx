// @vitest-environment jsdom
import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { getRoastSettings } from '@features/active-roast/model/settings';
import type { RoastTempChart } from '@features/active-roast/ui/RoastTempChart';
import type { TsvPoint } from '@shared/lib/tsv';
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileRoastChart } from './ProfileRoastChart';

const mocks = vi.hoisted(() => ({
    chart: vi.fn<(props: ComponentProps<typeof RoastTempChart>) => void>(),
    bbp: { data: [] as TsvPoint[], isLoading: false, isError: false },
    useBbpCurve: vi.fn(),
}));
vi.mock('@entities/roast', () => ({
    useBbpCurve: (...args: unknown[]) => {
        mocks.useBbpCurve(...args);
        return mocks.bbp;
    },
}));
vi.mock('@features/active-roast', async () => ({
    ...(await vi.importActual('@features/active-roast/lib/temperature')),
    useRoastSettings: () => ({
        ...getRoastSettings(),
        temperatureUnit: 'F',
        fontScalePct: 175,
        showET: true,
        showRoRChart: true,
        showRoRET: true,
        showPhaseBar: true,
        showControlChart: true,
        showControlHeat: true,
        bbpJoinCharge: true,
        tempMinC: 80,
        tempMaxC: 250,
    }),
}));
vi.mock('@features/active-roast/ui/RoastTempChart', () => ({
    RoastTempChart: (props: ComponentProps<typeof RoastTempChart>) => {
        mocks.chart(props);
        return <div data-testid="recorded-chart" />;
    },
}));
vi.mock('@features/active-roast/ui/SavedCurveLegend', () => ({ SavedCurveLegend: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

class ResizeObserverMock {
    observe() {}
    disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: ResizeObserverMock });

const sample: TsvPoint = { t: 0, bt: 150, et: 180, ror: 4, rorEt: 2, heater: null, fan: null, drum: null };
const profile = {
    user_id: 'owner',
    source_session_id: 'source-a',
    source_session: { tsv_path: 'source-a.tsv', bbp_tsv_path: 'source-a-bbp.tsv', events: null },
    duration_sec: 600,
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;
const render = (overrides: Partial<ComponentProps<typeof ProfileRoastChart>> = {}) => {
    if (!root) {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    }
    act(() =>
        root?.render(
            <ProfileRoastChart
                profile={profile}
                points={[sample]}
                events={[]}
                isLoading={false}
                isError={false}
                {...overrides}
            />,
        ),
    );
};
afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    mocks.chart.mockClear();
    mocks.useBbpCurve.mockClear();
    mocks.bbp.data = [];
});

it('shows every recorded channel with history display units and keeps gaps without inventing ET RoR', () => {
    render({ points: [sample, { ...sample, t: 7.5, et: null, ror: null, rorEt: undefined, heaterSet: 0 }] });
    expect(mocks.chart).toHaveBeenLastCalledWith(
        expect.objectContaining({
            xs: [0, 7.5],
            btActual: [toDisplayTemp(150, 'F'), toDisplayTemp(150, 'F')],
            etActual: [toDisplayTemp(180, 'F'), null],
            rorActual: [toDisplayRoR(4, 'F'), null],
            rorEtActual: [toDisplayRoR(2, 'F'), null],
            tempMinC: 80,
            tempMaxC: 250,
            showTargetCurve: false,
        }),
    );
    const props = mocks.chart.mock.lastCall?.[0];
    expect(props?.onEventMarkerEdit).toBeUndefined();
    expect(props?.onEventMarkerDrag).toBeUndefined();
    expect(props?.onAddNote).toBeUndefined();
});

it('switches the source curve and BBP identity even when the next source has the same point count', () => {
    render();
    render({
        profile: {
            ...profile,
            source_session_id: 'source-b',
            source_session: { ...profile.source_session, bbp_tsv_path: 'source-b-bbp.tsv' },
        },
        points: [{ ...sample, bt: 190, et: null, rorEt: undefined }],
    });
    expect(mocks.useBbpCurve).toHaveBeenLastCalledWith('owner', 'source-b', 'source-b-bbp.tsv');
    expect(mocks.chart.mock.lastCall?.[0].btActual).toEqual([toDisplayTemp(190, 'F')]);
    expect(mocks.chart.mock.lastCall?.[0].etActual).toEqual([null]);
    expect(mocks.chart.mock.lastCall?.[0].rorEtActual).toEqual([null]);
});

it.each([
    { isLoading: true, isError: false, status: 'history.expanded.chartLoading' },
    { isLoading: false, isError: true, status: 'history.expanded.chartUnavailable' },
    { isLoading: false, isError: false, status: 'profiles.detail.noRecordedData' },
])('shows $status without a synthetic or stale measured curve', ({ status, ...state }) => {
    render({ points: [], ...state });
    expect(host.textContent).toContain(status);
    expect(mocks.chart).not.toHaveBeenCalled();
});

it('joins only the saved source BBP and renders its recorded milestones', () => {
    mocks.bbp.data = [
        { ...sample, t: 0 },
        { ...sample, t: 20 },
    ];
    render({
        events: [
            { id: 'charge', type: 'Charge', time_sec: 0, bt: 150 },
            { id: 'drop', type: 'Drop', time_sec: 30, bt: 200 },
        ],
    });
    expect(mocks.chart.mock.lastCall?.[0]).toMatchObject({
        xs: [-20, 0],
        bbpRange: { start: -20, end: 0 },
        eventMarkers: expect.arrayContaining([expect.objectContaining({ event: 'Drop', timeSec: 30 })]),
    });
});

it('keeps temperature curves and phase marks without a phase bar or machine controls', () => {
    render({
        profile: {
            ...profile,
            source_session: { ...profile.source_session, heater_events: [{ t: 0, bt: 150, heater: 70 }] },
        },
        points: [{ ...sample, heater: 70, heaterSet: 65, fan: 40, drum: 55 }],
        events: [
            { id: 'charge', type: 'Charge', time_sec: 0, temp_c: 150 },
            { id: 'heater', type: 'Heater', time_sec: 1, note: '70%' },
            { id: 'command', type: 'Control', time_sec: 2, applied_control: { heater: 60, fan: 40, drum: 55 } },
            { id: 'gas-only', type: 'Note', time_sec: 3, gas: '60' },
            { id: 'plain-note', type: 'Note', time_sec: 4, note: 'Aroma changed' },
            {
                id: 'mixed-note',
                type: 'Note',
                time_sec: 5,
                note: 'Sweet aroma',
                gas: '50',
                airflow: '30',
                drum: '55',
                virtual: { damper: '10' },
            },
            { id: 'yellow', type: 'Yellow', time_sec: 10, temp_c: 160 },
            { id: 'fc', type: 'FC Start', time_sec: 20, temp_c: 180 },
            { id: 'drop', type: 'Drop', time_sec: 30, temp_c: 200 },
        ],
    });
    const props = mocks.chart.mock.lastCall?.[0];
    expect(props?.controlData).toBeUndefined();
    expect(props?.printControlData).toBeUndefined();
    expect(props?.showTooltip).toBe(false);
    expect(props?.height).toBeGreaterThanOrEqual(260);
    expect(props?.fontScale).toBe(11 / 12);
    expect(props?.gridBottom).toBe(32);
    expect(props?.eventMarkers.map((marker) => marker.event)).toEqual([
        'Charge',
        'Note',
        'Note',
        'Yellow',
        'FC Start',
        'Drop',
    ]);
    expect(props?.eventMarkers.find((marker) => marker.logId === 'mixed-note')).toMatchObject({ note: 'Sweet aroma' });
    for (const marker of props?.eventMarkers ?? []) {
        expect(marker).not.toHaveProperty('gas');
        expect(marker).not.toHaveProperty('airflow');
        expect(marker).not.toHaveProperty('drum');
        expect(marker).not.toHaveProperty('virtual');
    }
    expect(props).not.toHaveProperty('phaseSegments');
    expect(props?.btActual).toEqual([toDisplayTemp(150, 'F')]);
    expect(props?.etActual).toEqual([toDisplayTemp(180, 'F')]);
    expect(props?.rorActual).toEqual([toDisplayRoR(4, 'F')]);
    expect(props?.rorEtActual).toEqual([toDisplayRoR(2, 'F')]);
});
