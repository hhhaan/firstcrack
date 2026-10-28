import type { ECharts } from 'echarts';
import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test('curve callouts follow BT through resize and Fahrenheit conversion (#1012)', async ({ authedPage: page, db }) => {
    const path = `profiles/${E2E_USER.id}/curve-annotations.tsv`;
    const rows = ['time\tbt\tet\tror'];
    for (let t = 0; t <= 640; t += 10) {
        const bt = t <= 60 ? 200 - t : 140 + (t - 60) * 0.12;
        rows.push(`${t}\t${bt}\t${bt + 20}\t5`);
    }
    db.tsvFiles.set(path, `${rows.join('\n')}\n`);
    db.seedCompletedSession({
        tsv_path: path,
        duration_seconds: 640,
        drop_temp_celsius: 204.8,
        beans: {
            name: 'Curve annotation test',
            origin: 'Kenya',
            region: null,
            variety: null,
            process: null,
            farm: null,
        },
        events: [
            { id: 'c', type: 'Charge', time_sec: 0, temp_c: 200 },
            { id: 'tp', type: 'TP', time_sec: 60, temp_c: 140 },
            { id: 'y', type: 'Yellow', time_sec: 200, temp_c: 156.8 },
            { id: 'n', type: 'Note', time_sec: 210, note: 'Check aroma', temp_c: 158 },
            { id: 'f', type: 'FC Start', time_sec: 480, temp_c: 190.4 },
            { id: 'd', type: 'Drop', time_sec: 600, temp_c: 204.8 },
            { id: 'e', type: 'End', time_sec: 640, temp_c: 209.6 },
        ],
    });
    await goNav(page, 'history');
    await page.getByText('Curve annotation test').first().click();
    const chartElement = page.locator('[_echarts_instance_]').last();
    await expect(chartElement).toBeVisible();

    const readMarks = () =>
        chartElement.evaluate(async (element) => {
            const chartModule = await fetch('/src/features/active-roast/ui/RoastTempChart.tsx').then((response) =>
                response.text(),
            );
            const modulePath = chartModule.match(/from\s+["']([^"']*echarts[^"']*)["']/)?.[1];
            if (!modulePath) throw new Error('Missing ECharts module import');
            const runtime = await import(modulePath);
            const chart = runtime.getInstanceByDom(element) as ECharts;
            if (!chart) return null;
            const texts: { text: string; x: number; y: number; width: number; height: number }[] = [];
            const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
            for (const root of chart.getZr().storage.getRoots())
                root.traverse((element) => {
                    const node = element as unknown as {
                        type: string;
                        x: number;
                        y: number;
                        style?: { text?: string };
                        shape: { x1: number; y1: number; x2: number; y2: number };
                        getBoundingRect(): { x: number; y: number; width: number; height: number };
                    };
                    if (node.type === 'line') lines.push({ ...node.shape });
                    if (node.type === 'text' && node.style?.text) {
                        const rect = node.getBoundingRect();
                        texts.push({
                            text: node.style.text,
                            x: node.x + rect.x,
                            y: node.y + rect.y,
                            width: rect.width,
                            height: rect.height,
                        });
                    }
                });
            const series = chart.getOption().series as { name: string; data: [number, number][] }[];
            const values = series.find((model) => model.name === 'BT Actual')?.data ?? [];
            const sample = values.find(([time]) => time === 480);
            return {
                texts,
                lines,
                anchor: sample ? (chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, sample) as number[]) : [],
                width: chart.getWidth(),
            };
        });
    await expect
        .poll(async () => (await readMarks())?.texts.some((mark) => mark.text.startsWith('FC Start')))
        .toBe(true);
    const initial = await readMarks();
    expect(
        initial?.lines.some(
            (line) => Math.abs(line.x1 - initial.anchor[0]) < 0.1 && Math.abs(line.y1 - initial.anchor[1]) < 0.1,
        ),
    ).toBe(true);
    expect(initial?.texts.find((mark) => mark.text.startsWith('FC Start'))?.text).toContain('190.4°C');
    await page.setViewportSize({ width: 1024, height: 720 });
    await expect.poll(async () => (await readMarks())?.width).not.toBe(initial?.width);
    const resized = await readMarks();
    expect(
        resized?.lines.some(
            (line) => Math.abs(line.x1 - resized.anchor[0]) < 0.1 && Math.abs(line.y1 - resized.anchor[1]) < 0.1,
        ),
    ).toBe(true);
    await page.evaluate(async () => {
        const modulePath = '/src/features/active-roast/model/settings.ts';
        const settings = await import(modulePath);
        settings.updateRoastSettings({ temperatureUnit: 'F', fontScalePct: 175 });
    });
    await expect
        .poll(async () => (await readMarks())?.texts.find((mark) => mark.text.startsWith('FC Start'))?.text)
        .toContain('374.7°F');
    await chartElement.screenshot({ path: test.info().outputPath('curve-annotations.png') });
});
