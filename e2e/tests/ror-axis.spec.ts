import { expect, goNav, test } from '../fixtures/app';

test('RoR axis range, custom interval, and tick list are edited in roasting settings', async ({
    authedPage: page,
}) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    const navigation = settings.getByRole('navigation', { name: 'Settings', exact: true });
    await navigation.getByRole('button', { name: 'Roasting', exact: true }).click();
    await navigation.getByRole('button', { name: 'Axes & controls', exact: true }).click();
    const min = settings.locator('#roast-ror-min');
    const max = settings.locator('#roast-ror-max');
    await min.fill('-10');
    await min.blur();
    await max.fill('30');
    await max.blur();
    const grid = settings.getByRole('combobox', { name: 'RoR tick interval', exact: true });
    await expect(grid).toHaveText('5°C/min (default)');
    await expect(settings.locator('#roast-ror-interval')).toHaveCount(0);
    await grid.click();
    await page.getByRole('option', { name: 'Custom', exact: true }).click();
    const interval = settings.locator('#roast-ror-interval');
    await interval.fill('4');
    await interval.blur();
    const inputMethod = settings.getByRole('tablist', { name: 'Input method', exact: true });
    await inputMethod.getByRole('tab', { name: 'Specific RoR values', exact: true }).click();
    const ticks = settings.locator('#roast-ror-ticks');
    await ticks.fill('10, -5, 0, 0');
    await ticks.blur();
    await expect(ticks).toHaveValue('-5, 0, 10');
    await inputMethod.getByRole('tab', { name: 'Regular spacing', exact: true }).click();
    await expect(interval).toHaveValue('4');
    await navigation.getByRole('button', { name: 'Units & sampling', exact: true }).click();
    await navigation.getByRole('button', { name: 'Axes & controls', exact: true }).click();
    await expect(min).toHaveValue('-10');
    await expect(max).toHaveValue('30');
    await expect(grid).toHaveText('Custom');
    await expect(interval).toHaveValue('4');
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await goNav(page, 'roast');
    await expect(page.getByTestId('ror-axis-edit')).toHaveCount(0);
});
