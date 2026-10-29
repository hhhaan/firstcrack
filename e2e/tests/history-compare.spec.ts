import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';
import type { MockDb } from '../fixtures/mock-db';
import { installPersistentStore } from '../fixtures/persistent-store';

const BATCHES = ['Ethiopia Guji', 'Colombia Huila', 'Kenya Kirinyaga', 'Brazil Cerrado', 'Guatemala Antigua'];

function seedCompare(db: MockDb, withCurves = true) {
    BATCHES.forEach((name, index) => {
        const duration = 600 + index * 30;
        const key = `profiles/${E2E_USER.id}/compare-${index}.tsv`;
        const rows = [
            'time\tbt\tet\tror\theater\tfan\tdrum\theater_set\tet_raw\tbt_raw\tror_et\tsensor_timestamp\tsensor_clock\textra_readings',
        ];
        for (let time = 0; time <= duration; time += 5) {
            const bt =
                time <= 70
                    ? 200 - 105 * Math.sin(((time / 70) * Math.PI) / 2)
                    : 95 +
                      ((112 + index * 2) * (1 - Math.exp(-(time - 70) / 260))) / (1 - Math.exp(-(duration - 70) / 260));
            const et = 190 + 45 * (1 - Math.exp(-time / 240)) + index * 3;
            const ror = time < 70 ? 0 : 25 * Math.exp(-(time - 70) / 300);
            const extra = JSON.stringify(
                index === 3
                    ? []
                    : [
                          { id: 'inlet', label: 'Inlet', unit: '°C', value: et + 15 },
                          { id: 'pressure', label: 'Pressure', unit: 'Pa', value: 80 - time * 0.04 },
                      ],
            );
            rows.push(
                [time, bt.toFixed(1), et.toFixed(1), ror.toFixed(1), 50, 40, 50, 50, '', '', '4', '', '', extra].join(
                    '\t',
                ),
            );
        }
        if (withCurves) db.tsvFiles.set(key, `${rows.join('\n')}\n`);
        db.seedCompletedSession({
            tsv_path: withCurves ? key : null,
            duration_seconds: duration + 60,
            weight_grams: 1200,
            profile_batch_number: index + 1,
            total_batch_number: 251 + index,
            color_whole: index === 0 ? '64.2' : null,
            color_ground: index === 0 ? '65.1' : null,
            heater_events:
                index === 0
                    ? [
                          { t: 0, bt: 200, heater: 70 },
                          { t: 300, bt: 170, heater: 45 },
                      ]
                    : null,
            beans: { name, origin: null, region: null, variety: null, process: null, farm: null },
            roast_profiles: { name: `Filter ${index + 1}`, target_level: 'Light' },
            events: [
                { id: 'charge', type: 'Charge', time_sec: 0, temp_c: 200 },
                { id: 'yellow', type: 'Yellow', time_sec: 240 + index * 10, temp_c: 150 },
                { id: 'fc', type: 'FC Start', time_sec: 480 + index * 15, temp_c: 196 },
                { id: 'rolling', type: 'FC Rolling', time_sec: 500 + index * 15, temp_c: 198 },
                { id: 'drop', type: 'Drop', time_sec: duration, temp_c: 207 + index * 2 },
                { id: 'end', type: 'End', time_sec: duration + 60, temp_c: 190 },
            ],
        });
    });
}

test('history compare: five batches, user colors, overlay channels and responsive themes', async ({
    authedPage: page,
    db,
}, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installPersistentStore(page);
    await page.evaluate(() =>
        localStorage.setItem(
            'e2e:tauri-store:settings.json',
            JSON.stringify({
                'roast.settings': { curveStyles: { bt: { color: '#873d72' }, et: { color: '#1466a3' } } },
            }),
        ),
    );
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    seedCompare(db);
    db.seedCompletedSession({
        beans: { name: 'Sixth batch', origin: null, region: null, variety: null, process: null, farm: null },
    });
    await goNav(page, 'history');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    for (const name of BATCHES) await page.getByText(name, { exact: true }).first().click();
    await page.getByText('Sixth batch', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Compare (5)' }).click();
    const report = page.getByTestId('compare-report');
    const mainPlot = report.getByRole('region', { name: 'Curve Overlay', exact: true });
    await expect(report.getByRole('heading', { name: 'Compare Sessions (5)' })).toBeVisible();
    await expect(mainPlot.locator('canvas')).toBeVisible();
    await expect(report.locator('canvas')).toHaveCount(5);
    await expect(report.getByRole('checkbox', { name: 'Fan %', exact: true })).toBeChecked();
    await expect(report.getByRole('checkbox', { name: 'Drum RPM', exact: true })).toBeChecked();
    await expect(report.getByRole('checkbox', { name: 'BT °C', exact: true })).toBeChecked();
    await expect(report.getByRole('checkbox', { name: 'BT RoR °C/min', exact: true })).toBeChecked();
    await expect(report.getByRole('slider', { name: 'Curve Overlay', exact: true })).toHaveCount(1);
    await expect(report.getByText('Sixth batch', { exact: true })).toHaveCount(0);
    const batchRgb = await page.evaluate(() => {
        const paint = (token: string) => {
            const probe = document.createElement('canvas');
            probe.width = 1;
            probe.height = 1;
            const context = probe.getContext('2d');
            if (!context) return [0, 0, 0];
            context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
            context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        return {
            blue: paint('--color-compare-blue'),
            green: paint('--color-compare-green'),
        };
    });
    const countColor = (rgb: number[]) =>
        mainPlot.locator('canvas').evaluate((canvas: HTMLCanvasElement, expected: number[]) => {
            const context = canvas.getContext('2d');
            if (!context) return 0;
            const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let matches = 0;
            for (let i = 0; i < data.length; i += 4)
                if (data[i] === expected[0] && data[i + 1] === expected[1] && data[i + 2] === expected[2]) matches++;
            return matches;
        }, rgb);
    await expect.poll(() => countColor(batchRgb.blue)).toBeGreaterThan(8);
    await expect.poll(() => countColor(batchRgb.green)).toBeGreaterThan(8);

    const metrics = report.getByRole('table').last();
    const row = metrics.getByRole('row').filter({ hasText: 'Ethiopia Guji' });
    for (const text of ['10:00', '207.0°C', '20.0%', '16.7%', '#1 · PR251', '64.2', '65.1'])
        await expect(row).toContainText(text);
    const readout = report.getByTestId('compare-batch-readout').filter({ hasText: 'Filter 1' });
    await expect(readout).toContainText('#1');
    await expect(readout).toContainText('Filter 1');
    await expect(readout).not.toContainText('184.4');
    await mainPlot.focus();

    const moveTo = async (plot: typeof mainPlot, ratio: number) => {
        const canvas = plot.locator('canvas');
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        if (!box) throw new Error('Comparison chart is missing');
        await page.mouse.move(box.x + box.width * ratio, box.y + box.height * 0.45);
    };
    await moveTo(mainPlot, 0.25);
    await moveTo(mainPlot, 0.7);
    await report.getByRole('checkbox', { name: 'BT °C', exact: true }).uncheck();
    await report.getByRole('checkbox', { name: 'BT RoR °C/min', exact: true }).uncheck();
    await report.getByRole('checkbox', { name: 'Gas %', exact: true }).uncheck();
    await report.getByRole('checkbox', { name: 'Pressure Pa', exact: true }).check();
    await expect(report.getByTestId('compare-channel-et').locator('span').first()).toHaveCSS(
        'background-color',
        'rgb(20, 102, 163)',
    );
    await page.screenshot({ path: testInfo.outputPath('compare-pressure.png'), animations: 'disabled' });

    const first = report.getByRole('button', { name: /^Ethiopia Guji/ });
    const fourth = report.getByRole('button', { name: /^Brazil Cerrado/ });
    const hidden = ['Ethiopia Guji', 'Colombia Huila', 'Kenya Kirinyaga', 'Guatemala Antigua'];
    for (const name of hidden) await report.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(fourth).toBeDisabled();
    await expect(report.getByRole('status')).toHaveText('No recorded values for this sensor in the visible batches.');
    for (const name of hidden) await report.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await report.getByRole('checkbox', { name: 'Pressure Pa', exact: true }).uncheck();
    await report.getByRole('checkbox', { name: 'BT °C', exact: true }).check();
    await moveTo(mainPlot, 0.5);
    await page.mouse.wheel(0, -100);
    await report.getByRole('button', { name: 'Reset zoom' }).click();
    await expect(report.getByRole('button', { name: 'Reset zoom' })).toHaveCount(0);
    await moveTo(mainPlot, 0.5);
    await page.screenshot({ path: testInfo.outputPath('compare-light.png'), animations: 'disabled' });
    await first.focus();
    await page.screenshot({ path: testInfo.outputPath('compare-focus.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await report.getByRole('checkbox', { name: 'ET °C', exact: true }).check();
    await report.getByRole('checkbox', { name: 'ET °C', exact: true }).uncheck();
    await moveTo(mainPlot, 0.5);
    await page.screenshot({ path: testInfo.outputPath('compare-dark.png'), animations: 'disabled' });
    for (const viewport of [
        { width: 1024, height: 680 },
        { width: 800, height: 680 },
    ]) {
        await page.setViewportSize(viewport);
        await expect(report.getByRole('button', { name: 'Roast History', exact: true })).toBeInViewport();
        expect(await report.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    const scroller = report.getByRole('group', { name: 'Batch comparison', exact: true });
    await scroller.scrollIntoViewIfNeeded();
    await expect(scroller).toHaveCSS('scrollbar-width', 'auto');
    const geometry = await scroller.evaluate((element) => ({
        width: element.clientWidth,
        content: element.scrollWidth,
        scrollbar: getComputedStyle(element, '::-webkit-scrollbar').display,
    }));
    expect(geometry.content).toBeGreaterThan(geometry.width);
    expect(geometry.scrollbar).toBe('block');
    const scrollBox = await scroller.boundingBox();
    if (!scrollBox) throw new Error('Comparison scrollbar is missing');
    await page.mouse.move(scrollBox.x + 30, scrollBox.y + scrollBox.height - 7);
    await page.mouse.down();
    await page.mouse.move(scrollBox.x + scrollBox.width - 20, scrollBox.y + scrollBox.height - 7, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await scroller.focus();
    const beforeKeyScroll = await scroller.evaluate((element) => element.scrollLeft);
    await scroller.press('ArrowLeft');
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeLessThan(beforeKeyScroll);
    await expect(scroller).toBeFocused();
    await readout.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('compare-small.png'), animations: 'disabled' });
    await report.getByRole('button', { name: 'Roast History', exact: true }).click();
    await expect(report).toBeHidden();
});

test('history compare: metrics remain available without curve data', async ({ authedPage: page, db }) => {
    seedCompare(db, false);
    await goNav(page, 'history');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    for (const name of BATCHES.slice(0, 2)) await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Compare (2)' }).click();
    const report = page.getByTestId('compare-report');
    await expect(report.getByRole('status')).toContainText('No curve data in selected sessions');
    await expect(report.getByRole('row').filter({ hasText: 'Ethiopia Guji' })).toContainText('207.0°C');
});
