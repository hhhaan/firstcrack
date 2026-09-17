// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { BbpHistoryChart } from './BbpHistoryChart';

const mocks = vi.hoisted(() => ({
    query: { data: [] as { t: number; bt: number; et: number | null }[], isLoading: false, isError: false },
    chart: vi.fn(),
    useBbpCurve: vi.fn(),
}));
vi.mock('@entities/roast', () => ({
    useBbpCurve: (...args: unknown[]) => {
        mocks.useBbpCurve(...args);
        return mocks.query;
    },
}));
vi.mock('@features/active-roast', async () => ({
    ...(await vi.importActual('@features/active-roast/lib/temperature')),
    useRoastSettings: () => ({ temperatureUnit: 'F', tempMinC: 100, tempMaxC: 250 }),
}));
vi.mock('@features/active-roast/ui/RoastTempChart', () => ({
    RoastTempChart: (props: unknown) => {
        mocks.chart(props);
        return <div data-testid="curve" />;
    },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('renders this session’s BBP metadata, Fahrenheit curve and distinct unavailable states', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const session = {
        id: 'charge-session',
        user_id: 'owner',
        bbp_tsv_path: 'saved.bbp.tsv',
        bbp_seconds: 92,
        charge_temp_celsius: 185,
    } as ComponentProps<typeof BbpHistoryChart>['session'];
    const render = async () => {
        await act(async () => root.render(<BbpHistoryChart session={session} />));
    };
    await render();
    expect(mocks.useBbpCurve).toHaveBeenLastCalledWith('owner', 'charge-session', 'saved.bbp.tsv');
    expect(container.textContent).toContain('bbp.empty');
    expect(container.querySelector('[data-testid="curve"]')).toBeNull();
    mocks.query.isLoading = true;
    await render();
    expect(container.textContent).toContain('bbp.loading');
    mocks.query.isLoading = false;
    mocks.query.isError = true;
    await render();
    expect(container.textContent).toContain('bbp.failed');
    mocks.query.isError = false;
    mocks.query.data = [
        { t: 2, bt: 210, et: null },
        { t: 92, bt: 185, et: 90 },
    ];
    await render();
    expect(container.textContent).toContain('1:32');
    expect(container.textContent).toContain('365');
    expect(mocks.chart).toHaveBeenLastCalledWith(
        expect.objectContaining({
            xs: [2, 92],
            btActual: [410, 365],
            etActual: [null, 194],
            tempMinC: 90,
            showTargetCurve: false,
            xViewMin: 0,
            xViewMax: 92,
        }),
    );
    await act(async () => root.unmount());
});
