import { expect, goNav, test } from '../fixtures/app';

const chartModules = new WeakMap<import('@playwright/test').Page, string>();
const readChart = async (page: import('@playwright/test').Page) => {
    let modulePath = chartModules.get(page);
    if (!modulePath) {
        const source = await (await page.request.get('/src/features/active-roast/ui/RoastTempChart.tsx')).text();
        modulePath = source.match(/from\s+["']([^"']*\/echarts\.js[^"']*)["']/)?.[1];
        if (!modulePath) throw new Error('ECharts dependency URL missing from actual Vite module');
        chartModules.set(page, modulePath);
    }
    return page.evaluate(async (modulePath) => {
        const echarts = await import(modulePath);
        const surface = document.querySelector('[aria-label^="Temperature curve chart"]');
        const element = surface?.querySelector('[_echarts_instance_]');
        const chart = element ? echarts.getInstanceByDom(element) : null;
        if (!chart) return null;
        const option = chart.getOption();
        return {
            axes: option.xAxis.map((axis: { min: number; max: number }) => ({ min: axis.min, max: axis.max })),
            bt: option.series.find((series: { name: string }) => series.name === 'BT Actual')?.data as [
                number,
                number | null,
            ][],
            bbp: option.series.some((series: { markArea?: { data?: unknown[] } }) =>
                Boolean(series.markArea?.data?.length),
            ),
        };
    }, modulePath);
};

test('BBP continues through Charge, expands time with headroom, and preserves manual zoom on both grids', async ({
    authedPage: page,
}) => {
    await goNav(page, 'roast');
    await expect(page.getByTestId('bbp-target-status')).toBeVisible();
    await page.evaluate(async () => {
        const base = '/src/features/active-roast/model/';
        const { useBbpStore } = await import(`${base}bbp.ts`);
        const { useRoastingStore } = await import(`${base}status.ts`);
        const { updateRoastSettings } = await import(`${base}settings.ts`);
        updateRoastSettings({
            bbpEnabled: true,
            showControlChart: true,
            showControlHeat: true,
            autoChargeEnabled: false,
            autoDropEnabled: false,
        });
        useRoastingStore.setState({ phase: 'standby', awaitingNextCharge: true });
        useBbpStore.getState().begin(
            Date.now() - 850_000,
            [0, 120, 300, 600, 850].map((t) => ({ t, bt: 190 + t / 100, et: 210, heater: 50, fan: 40, drum: 55 })),
        );
    });

    await expect.poll(async () => (await readChart(page))?.axes[0].max).toBeGreaterThanOrEqual(940);
    const surface = page.getByLabel(
        'Temperature curve chart. Use wheel or plus and minus to zoom, drag or use left and right arrows to pan, and 0 to reset zoom.',
    );
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + 80);
    await page.mouse.wheel(0, -500);
    await expect.poll(async () => (await readChart(page))?.axes[0].min).toBeGreaterThan(0);
    const before = await readChart(page);
    const origin = await page.evaluate(async () => {
        const path = '/src/features/active-roast/model/status.ts';
        const { useRoastingStore } = await import(path);
        const store = useRoastingStore.getState();
        store.startCharge(undefined, store.prepared.workspaceOwnerId ?? undefined, { bt: 200, unit: 'C' });
        const capture = useRoastingStore.getState().bbpCapture;
        return (capture.chargeMs - capture.startMs) / 1000;
    });
    await expect.poll(async () => (await readChart(page))?.axes[0].min).toBeLessThan(0);
    const after = await readChart(page);
    expect((after?.axes[0].min ?? 0) + origin).toBeCloseTo(before?.axes[0].min ?? 0, 2);
    expect((after?.axes[0].max ?? 0) + origin).toBeCloseTo(before?.axes[0].max ?? 0, 2);
    expect(after?.axes).toHaveLength(2);
    expect(after?.axes[1]).toEqual(after?.axes[0]);
    expect(after?.bt.some(([time, value]) => time < 0 && value != null)).toBe(true);
    expect(after?.bbp).toBe(true);
    await page.evaluate(async () => {
        const path = '/src/features/active-roast/model/status.ts';
        const { useRoastingStore } = await import(path);
        useRoastingStore.getState().setLivePoints([
            { time: 0, label: '0:00', bt: 200, et: 210, ror: null, ror_et: null, heater: 50, fan: 40, drum: 55 },
            { time: 1200, label: '20:00', bt: 205, et: 215, ror: 3, ror_et: 2, heater: 30, fan: 50, drum: 55 },
        ]);
    });
    await expect.poll(async () => (await readChart(page))?.axes[0].max).toBe(after?.axes[0].max);
    await surface.focus();
    await page.keyboard.press('0');
    await expect.poll(async () => (await readChart(page))?.axes[0].max).toBeGreaterThanOrEqual(1290);
    const expanded = await readChart(page);
    expect(expanded?.axes[1]).toEqual(expanded?.axes[0]);
    expect(expanded?.bt.some(([time]) => time === 1200)).toBe(true);
    await page.screenshot({ path: '/tmp/firstcrack-1048-continuous-chart.png', fullPage: true });
});
