import { expect, goNav, test } from '../fixtures/app';
import { installPersistentStore } from '../fixtures/persistent-store';

test('control chart merge preference switches live and survives reload', async ({ authedPage: page }, testInfo) => {
    await installPersistentStore(page);
    await goNav(page, 'roast');
    await page.waitForFunction(() => Boolean(window.__FC_E2E__?.forceChargedSession));
    await page.evaluate(() => window.__FC_E2E__?.forceChargedSession());
    const settings = page.getByTestId('settings-page');
    const toggle = settings.getByRole('switch', { name: /^Merge into temperature chart/ });
    const openControls = async () => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await settings.getByRole('navigation').getByRole('button', { name: 'Roasting', exact: true }).click();
        await settings.getByRole('navigation').getByRole('button', { name: 'Axes & controls', exact: true }).click();
    };
    await openControls();
    await expect(toggle).not.toBeChecked();
    await expect(settings.getByText('Band height', { exact: true })).toBeVisible();
    await toggle.check();
    await expect(settings.getByText('Band height', { exact: true })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('merged-control-settings.png'), animations: 'disabled' });
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    const chart = page.getByRole('region', { name: /^Temperature curve chart/ });
    await expect(chart.locator('canvas').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('merged-control-chart.png'), animations: 'disabled' });
    await expect
        .poll(() =>
            page.evaluate(() => {
                const stored = JSON.parse(localStorage.getItem('e2e:tauri-store:settings.json') ?? '{}');
                return stored['roast.settings']?.mergeControlChart;
            }),
        )
        .toBe(true);
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await goNav(page, 'roast');
    await expect(chart.locator('canvas').first()).toBeVisible();
    await openControls();
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(settings.getByText('Band height', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await goNav(page, 'roast');
    await expect(chart.locator('canvas').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('separated-control-chart.png'), animations: 'disabled' });
});
