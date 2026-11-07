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
vi.mock('@entities/machine', () => ({
    ROASTER_REGISTRY: {},
    useMachines: () => [
        { id: 'profile-machine', connectionParams: { write_map: { heater: { unit: '%' } } } },
        { id: 'source-machine', connectionParams: { write_map: { heater: { unit: 'kPa' } } } },
    ],
}));
vi.mock('@entities/roast', () => ({
    useBbpCurve: (...args: unknown[]) => {
        mocks.useBbpCurve(...args);
        return mocks.bbp;
    },
}));
vi.mock('@features/active-roast', async () => ({
    ...(await vi.importActual('@features/active-roast/lib/temperature')),
    ...(await vi.importActual('@features/active-roast/lib/phases')),
    useRoastSettings: () => ({
        ...getRoastSettings(),
        temperatureUnit: 'F',
        showET: true,
        showRoRChart: true,
        showRoRET: true,
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

const sample: TsvPoint = { t: 0, bt: 150, et: 180, ror: 4, rorEt: 2, heater: null, fan: null, drum: null };
const profile = {
    user_id: 'owner',
    machine_id: 'profile-machine',
    machine_roaster_key: null,
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
            controlData: expect.objectContaining({ heatSet: [null, 0], heatSetUnit: '%' }),
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

it('uses the source machine Heat set unit when the profile machine differs', () => {
    render({
        profile: { ...profile, source_session: { ...profile.source_session, machine_id: 'source-machine' } },
        points: [{ ...sample, heaterSet: 0 }],
    });
    expect(mocks.chart.mock.lastCall?.[0].controlData).toMatchObject({ heatSet: [0], heatSetUnit: 'kPa' });
});
