import { expect, goNav, test } from '../fixtures/app';

test('RoR axis minimum, maximum, and tick interval can be edited during a roast', async ({ authedPage: page }) => {
    await goNav(page, 'roast');
    await page.getByTestId('ror-axis-edit').click();
    await page.getByLabel('Minimum', { exact: true }).fill('-10');
    await page.getByLabel('Maximum', { exact: true }).fill('30');
    await page.getByLabel('Tick interval', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByLabel('Minimum', { exact: true })).toBeHidden();
    await page.getByTestId('ror-axis-edit').click();
    await expect(page.getByLabel('Minimum', { exact: true })).toHaveValue('-10');
    await expect(page.getByLabel('Maximum', { exact: true })).toHaveValue('30');
    await expect(page.getByLabel('Tick interval', { exact: true })).toHaveValue('5');
});
