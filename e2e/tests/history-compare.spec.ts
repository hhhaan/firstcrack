import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';
import type { MockDb } from '../fixtures/mock-db';

const BATCHES = ['Ethiopia Guji', 'Colombia Huila', 'Kenya Kirinyaga'];

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
            const extra = JSON.stringify([
                { id: 'inlet', label: 'Inlet', unit: '°C', value: et + 15 },
                { id: 'pressure', label: 'Pressure', unit: 'Pa', value: 80 - time * 0.04 },
            ]);
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
    await page.getByRole('button', { name: 'Compare (3)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Compare Sessions (3)' });
    await expect(dialog.locator('canvas').first()).toBeVisible();

    const row = dialog.getByRole('row').filter({ hasText: 'Ethiopia Guji' });
    await expect(row).toContainText('10:00');
    await expect(row).toContainText('207.0°C');
    await expect(row).toContainText('20.0%');
    await expect(row).toContainText('16.7%');
    await expect(dialog.getByRole('checkbox')).toHaveCount(6);
    for (const name of ['BT', 'ET', 'BT RoR', 'ET RoR', 'Inlet °C', 'Pressure Pa']) {
        await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeChecked();
    }
    await page.screenshot({ path: testInfo.outputPath('compare-light.png'), animations: 'disabled' });

    const inlet = dialog.getByRole('checkbox', { name: /^Inlet/ });
    await inlet.focus();
    await page.keyboard.press('Space');
    await expect(inlet).not.toBeChecked();

    const first = dialog.getByRole('button', { name: /^Ethiopia Guji/ });
    const second = dialog.getByRole('button', { name: /^Colombia Huila/ });
    const third = dialog.getByRole('button', { name: /^Kenya Kirinyaga/ });
    await first.click();
    await second.click();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(third).toBeDisabled();
    await first.click();
    await second.click();

    await dialog.getByRole('region', { name: 'Temp & RoR' }).hover();
    await page.mouse.wheel(0, -100);
    await dialog.getByRole('button', { name: 'Reset zoom' }).click();
    await expect(dialog.getByRole('button', { name: 'Reset zoom' })).toHaveCount(0);

    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await inlet.focus();
    await page.keyboard.press('Space');
    await expect(inlet).toBeChecked();
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
