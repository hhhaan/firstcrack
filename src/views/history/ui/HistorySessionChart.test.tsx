// @vitest-environment jsdom
import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import type { TsvPoint } from '@shared/lib/tsv';
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { HistorySessionChart } from './HistorySessionChart';

const mocks = vi.hoisted(() => ({
    query: { data: [] as TsvPoint[], isLoading: false, isError: false },
    roast: { points: [] as TsvPoint[], isLoading: false, isError: false },
    target: [] as TsvPoint[],
    targetBbp: { data: [] as TsvPoint[], isLoading: false, isError: false },
    targetSource: 'session',
    chart: vi.fn(),
    useBbpCurve: vi.fn(),
    exportPdf: vi.fn(),
    settingsOverrides: {} as Record<string, unknown>,
    dataUrl: 'data:image/jpeg;base64,qq',
}));
vi.mock('@entities/roast', () => ({
    useHistoryChart: () => mocks.roast,
    sessionBeanName: () => 'E2E Ethiopia',
    useBbpCurve: (...args: unknown[]) => {
        mocks.useBbpCurve(...args);
        return args[1] === 'charge-session' ? mocks.query : mocks.targetBbp;
    },
}));
vi.mock('@features/export-history-pdf', () => ({
    historyPdfFilename: () => 'roast-graph-e2e-ethiopia-26-09-20.pdf',
    useExportHistoryPdf: () => mocks.exportPdf,
}));
vi.mock('@shared/store/toast', () => ({ useToastStore: { getState: () => ({ show: vi.fn() }) } }));
vi.mock('@entities/roast-profile', () => ({
    useRoastProfiles: () => ({
        data: [
            {
                id: 'target-profile',
                user_id: 'owner',
                name: 'Reference',
                source_session_id: 'target-session',
                source_session: { tsv_path: 'target.tsv', bbp_tsv_path: 'target.bbp.tsv', bbp_seconds: 120 },
            },
        ],
    }),
    useResolvedProfileCurve: () => ({ points: mocks.target, source: mocks.targetSource }),
    resolveSourceSession: (source: unknown) => source,
}));
vi.mock('@features/active-roast', async () => ({
    ...(await vi.importActual('@features/active-roast/lib/temperature')),
    ...(await vi.importActual('@features/active-roast/lib/phases')),
    useRoastSettings: () => ({
        temperatureUnit: 'F',
        showET: true,
        showRoRChart: true,
        showRoRET: true,
        showControlChart: true,
        showControlDrum: true,
        showControlHeat: true,
        showControlFan: true,
        controlChartHeightPct: 21,
        controlYMin: 0,
        controlYMax: 100,
        rorYMin: -5,
        rorYMax: 20,
        tempMinC: 100,
        tempMaxC: 250,
        eventMarkerStyle: 'line',
        showTargetCurve: true,
        showProfileBt: true,
        showProfileEt: true,
        showProfileRor: true,
        showProfileDrum: true,
        showProfileHeat: true,
        showProfileFan: true,
        bbpJoinCharge: false,
        ...mocks.settingsOverrides,
    }),
    useCurveStyles: () => {
        const { CSS_CURVE_TOKENS, DEFAULT_CURVE_STYLES, resolveCurveStyles } = curveStyleModule;
        return resolveCurveStyles(DEFAULT_CURVE_STYLES, CSS_CURVE_TOKENS);
    },
    CurveSwatch: () => null,
    useRoastingStore: (selector: (state: { phase: string }) => unknown) => selector({ phase: 'idle' }),
}));
const curveStyleModule = await vi.importActual<typeof import('@features/active-roast/lib/curve-style')>(
    '@features/active-roast/lib/curve-style',
);
vi.mock('@features/active-roast/lib/serialize-roast-events', () => ({
    parseStoredRoastEvents: () => [],
    storedEventsToMarkers: () => [{ event: 'Charge', timeSec: 0 }],
    storedEventsToLogEntries: () => [],
    storedEventsToControlChanges: () => [{ timeSec: 30, values: { heater: 0, fan: 1.2, drum: 55 } }],
}));
vi.mock('@shared/store/theme', () => ({ useThemeStore: () => 'light' }));
vi.mock('@features/active-roast/ui/RoastTempChart', async () => {
    const react = await vi.importActual<typeof import('react')>('react');
    return {
        RoastTempChart: react.forwardRef((props: unknown, ref) => {
            mocks.chart(props);
            react.useImperativeHandle(ref, () => ({
                capturePdf: async () => ({
                    chartDataUrl: mocks.dataUrl,
                    legend: [
                        { color: '#009d4c', label: 'BT (°F)', lineType: 'solid' },
                        { color: '#c34839', label: 'ET (°F)', lineType: 'solid' },
                        { color: '#3d7ac2', label: 'BT RoR (°F/min)', lineType: 'solid' },
                    ],
                }),
                beginMarkerDrag: () => false,
                moveMarkerDrag: () => false,
                endMarkerDrag: () => false,
                hitTestMarker: () => false,
                openMarkerEdit: () => false,
            }));
            return <div data-testid="curve" />;
        }),
    };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../hooks/useRoastRecordSave', () => ({
    useRoastRecordSave: () => ({
        canWrite: false,
        isPending: false,
        saveEvents: vi.fn(),
        saveHeater: vi.fn(),
        errorText: () => 'fail',
    }),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('joins BBP and roast in one Charge-relative chart and keeps roast visible on BBP loading/failure/absence', async () => {
    const container = document.createElement('div');
    const chartHost = document.createElement('div');
    const exportContainer = document.createElement('div');
    container.append(chartHost, exportContainer);
    const root = createRoot(chartHost);
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
        ror: -2,
        rorEt: 3,
        heater: 20,
        fan: 30,
        drum: 60,
    });
    mocks.roast.points = [point(0, 185, 200), point(60, 150, 210)];
    mocks.query.data = [point(2, 210, null), point(90, 185, 90), point(92, 999, 999)];
    mocks.target = [
        { t: 0, bt: 100, et: 110, ror: 4, heater: 7, fan: 0, drum: 9 },
        { t: 30, bt: 120, et: null, ror: null, heater: null, fan: null, drum: null },
    ];
    const render = async () => {
        await act(async () => root.render(<HistorySessionChart session={session} exportContainer={exportContainer} />));
    };
    await render();
    expect(mocks.useBbpCurve).toHaveBeenCalledWith('owner', 'charge-session', 'saved.bbp.tsv');
    expect(container.querySelectorAll('[data-testid="curve"]')).toHaveLength(1);
    const pdfBtn = container.querySelector('[data-testid="history-export-pdf"]') as HTMLButtonElement;
    expect(exportContainer.contains(pdfBtn)).toBe(true);
    expect(chartHost.querySelector('[data-testid="history-export-pdf"]')).toBeNull();
    expect(exportContainer.querySelectorAll('button[aria-pressed]')).toHaveLength(1);
    expect(chartHost.querySelector('button[aria-pressed]')).toBeNull();
    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(1);
    expect(pdfBtn.disabled).toBe(false);
    await act(async () => pdfBtn.click());
    expect(mocks.exportPdf).toHaveBeenCalledWith(
        expect.objectContaining({
            filename: 'roast-graph-e2e-ethiopia-26-09-20.pdf',
            chartDataUrl: mocks.dataUrl,
            title: 'history.title',
            legend: expect.arrayContaining([
                expect.objectContaining({ label: 'BT (°F)', lineType: 'solid', color: expect.any(String) }),
            ]),
        }),
    );
    expect(container.querySelector('[data-testid="curve"]')).toBeTruthy();
    expect(container.textContent).toContain('1:32');
    expect(container.textContent).toContain('365');
    expect(mocks.chart).toHaveBeenLastCalledWith(
        expect.objectContaining({
            xs: [-90, -2, 0, 60],
            btActual: [410, 365, 365, 302],
            etActual: [null, 194, 392, 410],
            rorActual: [null, null, -3.6, -3.6],
            rorEtActual: [5.4, 5.4, 5.4, 5.4],
            showET: true,
            showRoR: true,
            showRoRET: true,
            rorYMin: -5,
            rorYMax: 20,
            tempMinC: 100,
            tempMaxC: 250,
            printTempBounds: { tempMinC: 80, tempMaxC: 220 },
            bbpRange: { start: -92, end: 0 },
            xViewMin: -92,
            xViewMax: 120,
            showControlTailLabels: false,
            showTooltip: false,
            eventMarkers: [{ event: 'Charge', timeSec: 0 }],
            controlData: expect.objectContaining({
                xs: [-90, -2, 0, 60],
                heatPower: [20, 20, 20, 20],
                changes: [{ timeSec: 30, values: { heater: 0, fan: 1.2, drum: 55 } }],
            }),
        }),
    );
    expect(mocks.chart).toHaveBeenLastCalledWith(
        expect.objectContaining({
            showTargetCurve: true,
            targetXs: [0, 30],
            targetBt: [toDisplayTemp(100, 'F'), toDisplayTemp(120, 'F')],
            targetEt: [toDisplayTemp(110, 'F'), null],
            targetRor: [toDisplayRoR(4, 'F'), null],
            controlData: expect.objectContaining({
                reference: {
                    readUnits: [undefined, undefined],
                    xs: [0, 30],
                    heater: [7, null],
                    fan: [0, null],
                    drum: [9, null],
                },
            }),
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
    mocks.roast.points = [];
    mocks.query.data = [];
    await render();
    expect((container.querySelector('[data-testid="history-export-pdf"]') as HTMLButtonElement).disabled).toBe(true);
    mocks.roast.isError = false;
    mocks.target = [];
    session.duration_seconds = 11;
    mocks.roast.points = [
        { t: 0, bt: 186, et: null, ror: null, heater: null, fan: null, drum: null },
        { t: 11, bt: 187, et: null, ror: null, heater: null, fan: null, drum: null },
    ];
    await render();
    expect(mocks.chart).toHaveBeenLastCalledWith(
        expect.objectContaining({
            tempMinC: 100,
            tempMaxC: 250,
            xViewMax: 11,
            height: 440,
        }),
    );
    const originalPoints = structuredClone(mocks.roast.points);
    const originalEvents = structuredClone(session.events);
    mocks.settingsOverrides = {
        tempMinC: 130,
        tempMaxC: 240,
        rorYMin: 0,
        rorYMax: 15,
        showET: false,
        showRoRChart: false,
        showRoRET: true,
        showControlChart: false,
        showPhaseBar: false,
        showFcBand: false,
    };
    await render();
    expect(mocks.chart.mock.lastCall?.[0]).toMatchObject({
        tempMinC: 130,
        tempMaxC: 240,
        rorYMin: 0,
        rorYMax: 15,
        showET: false,
        showRoR: false,
        showRoRET: true,
        rorEtActual: [null, null],
        controlData: undefined,
        printControlData: expect.objectContaining({
            changes: [{ timeSec: 30, values: { heater: 0, fan: 1.2, drum: 55 } }],
        }),
        printTempBounds: { tempMinC: 160, tempMaxC: 210 },
        phaseSegments: [],
        showFcBand: false,
    });
    expect(mocks.chart.mock.lastCall?.[0].report).toBeUndefined();
    expect(container.textContent).not.toContain('ET ·');
    expect(container.textContent).not.toContain('RoR ·');
    expect(mocks.roast.points).toEqual(originalPoints);
    expect(session.events).toEqual(originalEvents);
    mocks.settingsOverrides = {
        rorYMin: -5,
        rorYMax: 20,
        showControlChart: true,
        showControlHeat: false,
        mergeControlChart: true,
        controlChartHeightPct: 35,
        controlYMin: 10,
        controlYMax: 80,
    };
    await render();
    expect(mocks.chart.mock.lastCall?.[0]).toMatchObject({
        rorYMin: -5,
        rorYMax: 20,
        showControlHeat: false,
        mergeControlChart: true,
        controlChartHeightPct: 35,
        controlYMin: 10,
        controlYMax: 80,
    });
    mocks.target = [{ t: 0, bt: 400, et: null, ror: null, heater: null, fan: null, drum: null }];
    mocks.targetSource = 'synthetic';
    await render();
    expect(mocks.chart.mock.lastCall?.[0]).toMatchObject({
        showTargetCurve: false,
        targetXs: [],
        tempMinC: 100,
        tempMaxC: 250,
        printTempBounds: { tempMinC: 170, tempMaxC: 410 },
    });
    await act(async () => root.unmount());
});

it('toggles actual and target BBP independently of live settings, including PDF inputs', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const session = {
        id: 'charge-session',
        user_id: 'owner',
        profile_id: 'target-profile',
        tsv_path: 'saved.tsv',
        bbp_tsv_path: 'saved.bbp.tsv',
        bbp_seconds: 92,
        duration_seconds: 60,
    } as ComponentProps<typeof HistorySessionChart>['session'];
    const point = (t: number, bt: number): TsvPoint => ({
        t,
        bt,
        et: null,
        ror: null,
        heater: 20,
        fan: 30,
        drum: 60,
    });
    mocks.roast.points = [point(0, 185), point(60, 150)];
    mocks.query.data = [point(0, 250), point(90, 185)];
    mocks.target = [point(0, 190), point(60, 155)];
    mocks.targetBbp.data = [point(0, 280), point(110, 190)];
    const render = async () => {
        await act(async () => root.render(<HistorySessionChart session={session} exportContainer={null} />));
    };
    await render();
    const toggle = container.querySelector('button[aria-pressed]');
    if (!(toggle instanceof HTMLButtonElement)) throw new Error('Missing BBP toggle');
    expect(container.querySelector('section')?.contains(toggle)).toBe(true);
    expect(toggle.textContent).toBe('history.showBbp');
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(mocks.chart.mock.lastCall?.[0]).toMatchObject({
        xs: [-92, -2, 0, 60],
        targetXs: [-120, -10, 0, 60],
        bbpRange: { start: -120, end: 0 },
        xViewMin: -120,
        printControlData: { xs: [-92, -2, 0, 60] },
        printTempBounds: { tempMinC: 140, tempMaxC: 290 },
    });
    await act(async () => toggle.click());
    expect(toggle.textContent).toBe('history.showBbp');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.disabled).toBe(false);
    expect(mocks.chart.mock.lastCall?.[0]).toMatchObject({
        xs: [0, 60],
        targetXs: [0, 60],
        bbpRange: undefined,
        xViewMin: 0,
        printControlData: { xs: [0, 60] },
        printTempBounds: { tempMinC: 140, tempMaxC: 200 },
    });
    await act(async () => toggle.click());
    expect(toggle.textContent).toBe('history.showBbp');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(mocks.chart.mock.lastCall?.[0]).toMatchObject({
        xs: [-92, -2, 0, 60],
        targetXs: [-120, -10, 0, 60],
        bbpRange: { start: -120, end: 0 },
        xViewMin: -120,
        printTempBounds: { tempMinC: 140, tempMaxC: 290 },
    });
    mocks.query.data = [];
    mocks.targetBbp.data = [];
    await render();
    expect(toggle.disabled).toBe(true);
    expect(container.textContent).toContain('bbp.empty');
    mocks.query.isLoading = true;
    await render();
    expect(toggle.disabled).toBe(true);
    expect(container.textContent).toContain('bbp.loading');
    mocks.targetBbp.data = [point(0, 280)];
    await render();
    expect(toggle.disabled).toBe(false);
    mocks.targetBbp.isError = true;
    await render();
    expect(toggle.disabled).toBe(true);
    mocks.query.isLoading = false;
    mocks.query.data = [point(0, 250)];
    await render();
    expect(toggle.disabled).toBe(false);
    session.bbp_tsv_path = null;
    session.profile_id = null;
    await render();
    expect(container.querySelector('button[aria-pressed]')).toBeNull();
    await act(async () => root.unmount());
});

beforeEach(() => {
    mocks.query = { data: [], isLoading: false, isError: false };
    mocks.roast = { points: [], isLoading: false, isError: false };
    mocks.target = [];
    mocks.targetBbp = { data: [], isLoading: false, isError: false };
    mocks.targetSource = 'session';
    mocks.settingsOverrides = {};
});

it('ends the drawn record at a Drop moved earlier and leaves the stored samples alone', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const point = (t: number): TsvPoint => ({ t, bt: 150, et: null, ror: null, heater: null, fan: null, drum: null });
    const stored = [point(0), point(300), point(540), point(600)];
    mocks.roast.points = stored;
    mocks.query.data = [];
    mocks.target = [];
    const session = (events: unknown) =>
        ({
            id: 'cropped-session',
            user_id: 'owner',
            tsv_path: 'saved.tsv',
            duration_seconds: 540,
            events,
        }) as ComponentProps<typeof HistorySessionChart>['session'];
    const render = async (events: unknown) => {
        await act(async () =>
            root.render(<HistorySessionChart session={session(events)} exportContainer={container} />),
        );
    };
    await render([{ id: 'd', type: 'Drop', time_sec: 540 }]);
    expect(mocks.chart).toHaveBeenLastCalledWith(expect.objectContaining({ xs: [0, 300, 540], xViewMax: 540 }));
    await render([
        { id: 'd', type: 'Drop', time_sec: 540 },
        { id: 'e', type: 'End', time_sec: 600 },
    ]);
    expect(mocks.chart).toHaveBeenLastCalledWith(expect.objectContaining({ xs: [0, 300, 540, 600] }));
    expect(stored).toHaveLength(4);
    await act(async () => root.unmount());
});
