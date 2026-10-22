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

test('history compare: five batches, user colors, channel tabs and responsive themes', async ({
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
    const dialog = page.getByRole('dialog', { name: 'Compare Sessions (5)' });
    const bt = dialog.getByRole('tab', { name: 'BT °C', exact: true });
    const mainPlot = dialog.getByRole('region', { name: 'BT °C', exact: true });
    await expect(mainPlot.locator('canvas')).toBeVisible();
    await expect(dialog.locator('canvas')).toHaveCount(1);
    await expect(dialog.getByRole('tab')).toHaveCount(7);
    await expect(bt).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('slider')).toHaveCount(0);
    await expect(dialog.getByTestId('compare-shared-cursor')).toHaveCount(0);
    await expect(dialog.getByTestId('compare-cursor-time')).toHaveCount(0);
    await expect(dialog.getByText('Sixth batch', { exact: true })).toHaveCount(0);
    await expect(bt.locator('span').first()).toHaveCSS('background-color', 'rgb(135, 61, 114)');
    await expect
        .poll(() =>
            mainPlot.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
                const context = canvas.getContext('2d');
                if (!context) return 0;
                const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
                let matches = 0;
                for (let i = 0; i < data.length; i += 4)
                    if (data[i] === 135 && data[i + 1] === 61 && data[i + 2] === 114) matches++;
                return matches;
            }),
        )
        .toBeGreaterThan(100);

    const metrics = dialog.getByRole('table').last();
    const row = metrics.getByRole('row').filter({ hasText: 'Ethiopia Guji' });
    for (const text of ['10:00', '207.0°C', '20.0%', '16.7%', '#1 · Σ#251', '64.2', '65.1'])
        await expect(row).toContainText(text);
    const readout = dialog.getByTestId('compare-batch-readout').filter({ hasText: 'Ethiopia Guji' });
    await expect(readout).toContainText('#1 · Σ#251');
    const gasValue = readout.locator('td').nth(4);
    await expect(gasValue).toHaveText('—');
    const panel = dialog.getByRole('tabpanel');
    await panel.focus();
    await page.keyboard.press('Home');
    await expect(gasValue).toHaveText('70.0');
    for (let step = 0; step < 5; step++) await page.keyboard.press('ArrowRight');
    await expect(readout.locator('td').first()).toHaveText('188.2');
    await expect(gasValue).toHaveText('70.0');
    await page.keyboard.press('End');
    await expect(gasValue).toHaveText('—');

    const moveTo = async (plot: typeof mainPlot, ratio: number) => {
        await plot.scrollIntoViewIfNeeded();
        const box = await plot.boundingBox();
        if (!box) throw new Error('Comparison chart is missing');
        await page.mouse.move(box.x + 32 + (box.width - 64) * ratio, box.y + 120);
    };
    await moveTo(mainPlot, 0.25);
    await expect(gasValue).toHaveText('70.0');
    await dialog.getByRole('tab', { name: 'Gas %', exact: true }).click();
    const gasPlot = dialog.getByRole('region', { name: 'Gas %', exact: true });
    await moveTo(gasPlot, 0.25);
    await expect(gasValue).toHaveText('70.0');
    await moveTo(gasPlot, 0.7);
    await expect(gasValue).toHaveText('45.0');
    await bt.click();
    await bt.focus();
    await page.keyboard.press('ArrowRight');
    const et = dialog.getByRole('tab', { name: 'ET °C', exact: true });
    await expect(et).toBeFocused();
    await expect(et).toHaveAttribute('aria-selected', 'true');
    await expect(et.locator('span').first()).toHaveCSS('background-color', 'rgb(20, 102, 163)');
    await page.keyboard.press('End');
    await expect(dialog.getByRole('tab', { name: 'Pressure Pa', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await page.keyboard.press('Home');
    await expect(bt).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByRole('tab', { name: 'Pressure Pa', exact: true })).toBeFocused();
    await expect(dialog.getByRole('region', { name: 'Pressure Pa' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('compare-pressure.png'), animations: 'disabled' });

    const first = dialog.getByRole('button', { name: /^Ethiopia Guji/ });
    const fourth = dialog.getByRole('button', { name: /^Brazil Cerrado/ });
    const hidden = ['Ethiopia Guji', 'Colombia Huila', 'Kenya Kirinyaga', 'Guatemala Antigua'];
    for (const name of hidden) await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(fourth).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveText('No recorded values for this sensor in the visible batches.');
    await expect(dialog.getByRole('tab')).toHaveCount(7);
    for (const name of hidden) await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await bt.click();
    await moveTo(mainPlot, 0.5);
    await page.mouse.wheel(0, -100);
    await dialog.getByRole('button', { name: 'Reset zoom' }).click();
    await expect(dialog.getByRole('button', { name: 'Reset zoom' })).toHaveCount(0);
    await moveTo(mainPlot, 0.5);
    await page.screenshot({ path: testInfo.outputPath('compare-light.png'), animations: 'disabled' });
    await first.focus();
    await page.screenshot({ path: testInfo.outputPath('compare-focus.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await et.click();
    await bt.click();
    await moveTo(mainPlot, 0.5);
    await page.screenshot({ path: testInfo.outputPath('compare-dark.png'), animations: 'disabled' });
    for (const viewport of [
        { width: 1024, height: 680 },
        { width: 800, height: 680 },
    ]) {
        await page.setViewportSize(viewport);
        await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await readout.scrollIntoViewIfNeeded();
    await gasValue.scrollIntoViewIfNeeded();
    await expect(gasValue).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('compare-small.png'), animations: 'disabled' });
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
