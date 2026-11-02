import { expect, test } from '../fixtures/app';

test('built-in manual controls toggle, and an added control keeps its own range', async ({ authedPage: page }) => {
    const openManual = async () => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('button', { name: 'Roasting', exact: true }).click();
        await page.getByRole('button', { name: 'Events', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Manual controls' })).toBeVisible();
    };

    await openManual();
    const section = page.locator('[data-settings-group="events"]').filter({
        has: page.getByRole('heading', { name: 'Manual controls' }),
    });
    const gas = section.getByRole('checkbox', { name: 'Gas', exact: true });
    await expect(gas).toBeChecked();
    await expect(section.getByRole('textbox', { name: 'Gas Name' })).toHaveCount(0);
    await gas.click();
    await expect(gas).not.toBeChecked();

    await section.getByRole('textbox', { name: 'Name', exact: true }).fill('Damper');
    await section.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(section.getByRole('checkbox', { name: 'Damper', exact: true })).toBeChecked();
    const unit = section.getByRole('textbox', { name: 'Damper Unit' });
    await unit.fill('kPa');
    await unit.blur();
    await expect(unit).toHaveValue('kPa');

    await section.getByRole('textbox', { name: 'Name', exact: true }).fill('Damper');
    await section.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(section.getByRole('alert')).toContainText('already used');

    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await openManual();
    const again = page.locator('[data-settings-group="events"]').filter({
        has: page.getByRole('heading', { name: 'Manual controls' }),
    });
    await expect(again.getByRole('checkbox', { name: 'Gas', exact: true })).not.toBeChecked();
    await expect(again.getByRole('textbox', { name: 'Damper Unit' })).toHaveValue('kPa');
    await again.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(again.getByRole('checkbox', { name: 'Damper', exact: true })).toHaveCount(0);
    await expect(again.getByRole('checkbox', { name: 'Gas', exact: true })).not.toBeChecked();
});
