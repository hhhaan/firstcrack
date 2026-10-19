import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';
import type { MockDb } from '../fixtures/mock-db';

const BATCHES = ['Ethiopia Guji', 'Colombia Huila', 'Kenya Kirinyaga', 'Brazil Cerrado'];

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

test('history compare: batch visibility, recorded sensors, zoom and responsive themes', async ({
    authedPage: page,
    db,
}, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    seedCompare(db);
    await goNav(page, 'history');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    for (const name of BATCHES) await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Compare (4)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Compare Sessions (4)' });
    await expect(dialog.locator('canvas').first()).toBeVisible();
    await expect(dialog.locator('fieldset svg line[stroke-dasharray]')).toHaveCount(0);
    await expect(dialog.getByTestId('compare-shared-cursor')).toHaveCSS('border-left-style', 'solid');

    const row = dialog.getByRole('row').filter({ hasText: 'Ethiopia Guji' });
    await expect(row).toContainText('10:00');
    await expect(row).toContainText('207.0°C');
    await expect(row).toContainText('20.0%');
    await expect(row).toContainText('16.7%');
    await expect(dialog.getByRole('checkbox')).toHaveCount(7);
    const bt = dialog.getByRole('checkbox', { name: 'BT °C', exact: true });
    await expect(bt).toBeChecked();
    for (const name of ['ET °C', 'BT RoR °C/min', 'ET RoR °C/min', 'Gas %']) {
        await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeChecked();
    }
    for (const name of ['Inlet °C', 'Pressure Pa']) {
        await expect(dialog.getByRole('checkbox', { name, exact: true })).not.toBeChecked();
    }
    const mainPlot = dialog.getByRole('region', { name: 'Temp & RoR', exact: true });
    const gasPlot = dialog.getByRole('region', { name: 'Gas %', exact: true });
    const readout = dialog.getByTestId('compare-batch-readout').filter({ hasText: 'Ethiopia Guji' });
    const gasValue = readout.locator('dl > div').filter({ hasText: 'Gas' }).locator('dd');
    const mainBox = await mainPlot.boundingBox();
    if (!mainBox) throw new Error('Temperature chart is missing');
    const plotX = (ratio: number) => mainBox.x + 38 + (mainBox.width - 38 - 32) * ratio;
    await page.mouse.move(plotX(0.25), mainBox.y + 120);
    await expect(gasValue).toHaveText('70.0');
    const cursor = dialog.getByTestId('compare-cursor-time');
    const time = await cursor.textContent();
    await gasPlot.scrollIntoViewIfNeeded();
    const gasBox = await gasPlot.boundingBox();
    if (!gasBox) throw new Error('Gas chart is missing');
    await page.mouse.move(plotX(0.25), gasBox.y + 60);
    await expect(cursor).toHaveText(time ?? '');
    await page.mouse.move(plotX(0.7), gasBox.y + 60);
    await expect(gasValue).toHaveText('45.0');
    const timeSlider = dialog.getByRole('slider', { name: 'Cursor time' });
    await timeSlider.focus();
    await page.keyboard.press('Home');
    await expect(cursor).toHaveText('00:00');
    await page.keyboard.press('ArrowRight');
    await expect(cursor).toHaveText('00:01');
    await timeSlider.evaluate((element) => element.blur());
    await mainPlot.hover();
    const ratios = await dialog
        .getByRole('group', { name: '4 selected' })
        .getByTestId('compare-batch-readout')
        .evaluateAll((buttons) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Canvas is unavailable');
            const luminance = (color: string) => {
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
                const linear = [r, g, b].map((value) => {
                    const channel = value / 255;
                    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
                });
                return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
            };
            const background = luminance(
                getComputedStyle(document.documentElement).getPropertyValue('--color-main-bg'),
            );
            return buttons.map((button) => {
                const foreground = luminance(getComputedStyle(button).borderLeftColor);
                return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
            });
        });
    expect(ratios).toHaveLength(4);
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath('compare-light.png'), animations: 'disabled' });

    const inlet = dialog.getByRole('checkbox', { name: 'Inlet °C', exact: true });
    await inlet.focus();
    await page.keyboard.press('Space');
    await expect(inlet).toBeChecked();
    await expect(bt).toBeChecked();
    const pressure = dialog.getByRole('checkbox', { name: 'Pressure Pa', exact: true });
    await pressure.focus();
    await page.keyboard.press('Space');
    await expect(dialog.getByRole('region', { name: 'Pressure Pa' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('compare-pressure.png'), animations: 'disabled' });

    const first = dialog.getByRole('button', { name: /^Ethiopia Guji/ });
    const second = dialog.getByRole('button', { name: /^Colombia Huila/ });
    const third = dialog.getByRole('button', { name: /^Kenya Kirinyaga/ });
    const fourth = dialog.getByRole('button', { name: /^Brazil Cerrado/ });
    await first.focus();
    await page.screenshot({ path: testInfo.outputPath('compare-focus.png'), animations: 'disabled' });
    await pressure.focus();
    await first.click();
    await second.click();
    await third.click();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(fourth).toBeDisabled();
    await expect(dialog.getByRole('status')).toContainText('No recorded values for this sensor');
    await first.click();
    await second.click();
    await third.click();
    await inlet.uncheck();
    await pressure.uncheck();

    await mainPlot.hover();
    await page.mouse.wheel(0, -100);
    await dialog.getByRole('button', { name: 'Reset zoom' }).click();
    await expect(dialog.getByRole('button', { name: 'Reset zoom' })).toHaveCount(0);

    for (const name of ['ET °C', 'BT RoR °C/min', 'ET RoR °C/min', 'Gas %']) {
        await dialog.getByRole('checkbox', { name, exact: true }).uncheck();
    }
    await expect(bt).toBeDisabled();
    await bt.focus();
    await page.keyboard.press('Space');
    await expect(bt).toBeChecked();
    for (const name of ['ET °C', 'BT RoR °C/min', 'ET RoR °C/min', 'Gas %']) {
        await dialog.getByRole('checkbox', { name, exact: true }).check();
    }

    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await inlet.focus();
    await page.keyboard.press('Space');
    await expect(inlet).toBeChecked();
    await inlet.uncheck();
    const gas = dialog.getByRole('checkbox', { name: 'Gas %', exact: true });
    await gas.uncheck();
    await gas.check();
    await gas.evaluate((element) => element.blur());
    await page.screenshot({ path: testInfo.outputPath('compare-dark.png'), animations: 'disabled' });
    for (const viewport of [
        { width: 1024, height: 680 },
        { width: 800, height: 680 },
    ]) {
        await page.setViewportSize(viewport);
        await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('compare-small.png'), animations: 'disabled' });
    await readout.scrollIntoViewIfNeeded();
    await expect(gasValue).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('compare-small-readouts.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
});

test('history compare: metrics remain available without curve data', async ({ authedPage: page, db }) => {
    seedCompare(db, false);
    await goNav(page, 'history');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    for (const name of BATCHES.slice(0, 2)) await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Compare (2)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Compare Sessions (2)' });
    await expect(dialog.getByRole('status')).toContainText('No curve data in selected sessions');
    await expect(dialog.getByRole('row').filter({ hasText: 'Ethiopia Guji' })).toContainText('207.0°C');
});
