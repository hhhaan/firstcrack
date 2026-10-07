// @vitest-environment jsdom
import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
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
    exportPdf: vi.fn(),
    dataUrl: 'data:image/jpeg;base64,qq',
}));
vi.mock('@entities/roast', () => ({
    useHistoryChart: () => mocks.roast,
    sessionBeanName: () => 'E2E Ethiopia',
    useBbpCurve: (...args: unknown[]) => {
        mocks.useBbpCurve(...args);
        return args[1] === 'charge-session' ? mocks.query : { data: [] };
    },
}));
vi.mock('@features/export-history-pdf', () => ({
    historyPdfFilename: () => 'roast-graph-e2e-ethiopia-26-09-20.pdf',
    historyPdfChartBox: () => ({ width: 2151, height: 1374 }),
    useExportHistoryPdf: () => mocks.exportPdf,
}));
vi.mock('@shared/store/toast', () => ({ useToastStore: { getState: () => ({ show: vi.fn() }) } }));
vi.mock('@entities/roast-profile', () => ({
    useRoastProfiles: () => ({ data: [] }),
    useResolvedProfileCurve: () => ({ points: mocks.target }),
    resolveSourceSession: () => null,
}));
vi.mock('@features/active-roast', async () => ({
    ...(await vi.importActual('@features/active-roast/lib/temperature')),
    ...(await vi.importActual('@features/active-roast/lib/phases')),
    useRoastSettings: () => ({
        temperatureUnit: 'F',
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
    }),
    useCurveStyles: () => {
        const { CSS_CURVE_TOKENS, DEFAULT_CURVE_STYLES, resolveCurveStyles } = curveStyleModule;
        return resolveCurveStyles(DEFAULT_CURVE_STYLES, CSS_CURVE_TOKENS);
    },
    CurveSwatch: () => null,
}));
const curveStyleModule = await vi.importActual<typeof import('@features/active-roast/lib/curve-style')>(
    '@features/active-roast/lib/curve-style',
);
vi.mock('@features/active-roast/lib/serialize-roast-events', () => ({
    parseStoredRoastEvents: () => [],
    storedEventsToMarkers: () => [{ event: 'Charge', timeSec: 0 }],
    storedEventsToLogEntries: () => [],
}));
vi.mock('@shared/store/theme', () => ({ useThemeStore: () => 'light' }));
vi.mock('@features/active-roast/ui/RoastTempChart', async () => {
    const react = await vi.importActual<typeof import('react')>('react');
    return {
        RoastTempChart: react.forwardRef((props: unknown, ref) => {
            mocks.chart(props);
            react.useImperativeHandle(ref, () => ({
                getDataURL: () => mocks.dataUrl,
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
        ror: 5,
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
    expect(pdfBtn.disabled).toBe(false);
    await act(async () => pdfBtn.click());
    expect(mocks.exportPdf).toHaveBeenCalledWith(
        expect.objectContaining({
            filename: 'roast-graph-e2e-ethiopia-26-09-20.pdf',
            chartDataUrl: mocks.dataUrl,
            header: expect.objectContaining({ bean: 'E2E Ethiopia' }),
            legend: expect.arrayContaining([
                expect.objectContaining({ label: 'Heat', lineType: 'solid', color: expect.any(String) }),
            ]),
        }),
    );
    expect(container.querySelector('[data-testid="curve"]')).toBeTruthy();
    expect(container.textContent).toContain('1:32');
    expect(container.textContent).toContain('365');
    expect(mocks.chart).toHaveBeenLastCalledWith(
        expect.objectContaining({
            report: true,
            xs: [-90, -2, 0, 60],
            btActual: [410, 365, 365, 302],
            etActual: [null, 194, 392, 410],
            rorActual: [null, null, 9, 9],
            tempMinC: 80,
            tempMaxC: 220,
            bbpRange: { start: -92, end: 0 },
            xViewMin: -92,
            xViewMax: 120,
            eventMarkers: [{ event: 'Charge', timeSec: 0 }],
            controlData: expect.objectContaining({ xs: [-90, -2, 0, 60], heatPower: [20, 20, 20, 20] }),
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
            tempMinC: 160,
            tempMaxC: 210,
            xViewMax: 11,
            height: 360,
        }),
    );
    await act(async () => root.unmount());
});
