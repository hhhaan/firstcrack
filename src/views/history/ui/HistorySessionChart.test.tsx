// @vitest-environment jsdom
import {
    clearPendingRoastSave,
    createPendingRoastSave,
    writePendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import type { TsvPoint } from '@shared/lib/tsv';
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HistorySessionChart } from './HistorySessionChart';

const mocks = vi.hoisted(() => ({
    query: { data: [] as TsvPoint[], isLoading: false, isError: false },
    roast: { points: [] as TsvPoint[], isLoading: false, isError: false },
    target: [] as TsvPoint[],
    chart: vi.fn(),
    useBbpCurve: vi.fn(),
}));
vi.mock('@entities/roast', () => ({
    useHistoryChart: () => mocks.roast,
    useBbpCurve: (...args: unknown[]) => {
        mocks.useBbpCurve(...args);
        return args[1] === 'charge-session' ? mocks.query : { data: [] };
    },
}));
vi.mock('@entities/roast-profile', () => ({
    useRoastProfiles: () => ({ data: [] }),
    useResolvedProfileCurve: () => ({ points: mocks.target }),
    resolveSourceSession: () => null,
}));
vi.mock('@features/active-roast', async () => ({
    ...(await vi.importActual('@features/active-roast/lib/temperature')),
    useRoastSettings: () => ({ temperatureUnit: 'F', tempMinC: 100, tempMaxC: 250, eventMarkerStyle: 'both' }),
}));
vi.mock('@features/active-roast/lib/serialize-roast-events', () => ({
    parseStoredRoastEvents: () => [],
    storedEventsToMarkers: () => [{ event: 'Charge', timeSec: 0 }],
}));
vi.mock('@shared/store/theme', () => ({ useThemeStore: () => 'light' }));
vi.mock('@features/active-roast/ui/RoastTempChart', () => ({
    RoastTempChart: (props: unknown) => {
        mocks.chart(props);
        return <div data-testid="curve" />;
    },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('joins BBP and roast in one Charge-relative chart and keeps roast visible on BBP loading/failure/absence', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const session = {
        id: 'charge-session',
        user_id: 'owner',
        tsv_path: 'saved.tsv',
        bbp_tsv_path: 'saved.bbp.tsv',
        bbp_seconds: 92,
        charge_temp_celsius: 185,
        duration_seconds: 120,
    } as ComponentProps<typeof HistorySessionChart>['session'];
    const point = (t: number, bt: number, et: number | null): TsvPoint => ({
        t,
        bt,
        et,
        ror: 5,
        heater: 20,
        fan: 30,
        drum: 60,
    });
    mocks.roast.points = [point(0, 185, 200), point(60, 150, 210)];
    mocks.query.data = [point(2, 210, null), point(90, 185, 90), point(92, 999, 999)];
    const render = async () => {
        await act(async () => root.render(<HistorySessionChart session={session} />));
    };
    await render();
    expect(mocks.useBbpCurve).toHaveBeenCalledWith('owner', 'charge-session', 'saved.bbp.tsv');
    expect(container.querySelectorAll('[data-testid="curve"]')).toHaveLength(1);
    expect(container.textContent).toContain('1:32');
    expect(container.textContent).toContain('365');
    expect(mocks.chart).toHaveBeenLastCalledWith(
        expect.objectContaining({
            xs: [-90, -2, 0, 60],
            btActual: [410, 365, 365, 302],
            etActual: [null, 194, 392, 410],
            rorActual: [null, null, 9, 9],
            tempMinC: 90,
            tempMaxC: 250,
            bbpRange: { start: -92, end: 0 },
            xViewMin: -92,
            xViewMax: 120,
            eventMarkers: [{ event: 'Charge', timeSec: 0 }],
            controlData: expect.objectContaining({ xs: [-90, -2, 0, 60], heatPower: [20, 20, 20, 20] }),
        }),
    );
    mocks.query.isError = true;
    await render();
    expect(container.textContent).toContain('bbp.failed');
    expect(mocks.chart).toHaveBeenLastCalledWith(
        expect.objectContaining({ xs: [0, 60], bbpRange: undefined, xViewMin: 0 }),
    );
    mocks.query.isError = false;
    mocks.query.data = [];
    mocks.query.isLoading = true;
    await render();
    expect(container.textContent).toContain('bbp.loading');
    expect(container.querySelectorAll('[data-testid="curve"]')).toHaveLength(1);
    mocks.query.isLoading = false;
    await render();
    expect(container.textContent).toContain('bbp.empty');
    expect(mocks.chart).toHaveBeenLastCalledWith(expect.objectContaining({ xs: [0, 60], bbpRange: undefined }));
    mocks.roast.points = [];
    mocks.roast.isError = true;
    mocks.query.data = [point(2, 210, null), point(90, 185, 90)];
    await render();
    expect(container.textContent).toContain('history.expanded.chartUnavailable');
    expect(mocks.chart).toHaveBeenLastCalledWith(expect.objectContaining({ xs: [-90, -2] }));
    await act(async () => root.unmount());
});

it('shows curve sync state instead of a missing-curve error', async () => {
    localStorage.clear();
    const container = document.createElement('div');
    const root = createRoot(container);
    const session = {
        id: 'charge-session',
        user_id: 'owner',
        tsv_path: null,
        bbp_tsv_path: null,
        bbp_seconds: null,
        duration_seconds: 0,
        events: [],
    } as unknown as ComponentProps<typeof HistorySessionChart>['session'];
    const pending = createPendingRoastSave(
        {
            userId: 'owner',
            sessionId: 'charge-session',
            roastStartTime: 0,
            elapsed: 0,
            rawBT: null,
            selectedBeanId: null,
            targetProfileId: null,
            planBatchHandoff: null,
            handoffBeanName: null,
            logEntries: [],
            formData: { notes: '', weightGrams: 0, roastLevel: null, beanId: null },
        },
        true,
    );
    pending.db = 'saved';
    writePendingRoastSave(pending);
    mocks.roast.isError = true;
    mocks.roast.points = [];
    await act(async () => root.render(<HistorySessionChart session={session} />));
    expect(container.textContent).toContain('activeRoast.recovery.curveSyncing');
    expect(container.textContent).not.toContain('history.expanded.chartUnavailable');

    const other = createPendingRoastSave(
        {
            ...pending.params,
            sessionId: 'other-session',
        },
        true,
    );
    other.db = 'saved';
    other.error = 'other failed';
    await act(async () => writePendingRoastSave(other));
    expect(container.textContent).toContain('activeRoast.recovery.curveSyncing');
    expect(container.textContent).not.toContain('activeRoast.recovery.curveRetry');

    pending.error = 'upload failed';
    await act(async () => writePendingRoastSave(pending));
    expect(container.textContent).toContain('activeRoast.recovery.curveRetry');
    expect(container.textContent).not.toContain('activeRoast.recovery.curveSyncing');

    pending.error = undefined;
    await act(async () => writePendingRoastSave(pending));
    expect(container.textContent).toContain('activeRoast.recovery.curveSyncing');

    await act(async () => clearPendingRoastSave('owner', 'charge-session'));
    expect(container.textContent).not.toContain('activeRoast.recovery.curveSyncing');
    expect(container.textContent).not.toContain('activeRoast.recovery.curveRetry');
    expect(container.textContent).toContain('history.expanded.chartUnavailable');
    await act(async () => root.unmount());
    localStorage.clear();
});
