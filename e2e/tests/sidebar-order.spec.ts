import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/app';

const navOrder = async (page: Page) =>
    page.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));

test('sidebar order is edited in general settings and roast does not collapse it', async ({ authedPage: page }) => {
    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveClass(/w-\[170px\]/);
    await expect(sidebar.getByText('Roasting', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Operations', { exact: true })).toBeVisible();
    expect(await navOrder(page)).toEqual([
        'nav-roast',
        'nav-history',
        'nav-profiles',
        'nav-machines',
        'nav-cupping',
        'nav-dashboard',
        'nav-schedule',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
    ]);

    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    await expect(settings.getByRole('heading', { name: 'Sidebar', exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Move Active Roast down', exact: true }).click();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();

    await expect(sidebar).toBeVisible();
    expect(await navOrder(page)).toEqual([
        'nav-history',
        'nav-roast',
        'nav-profiles',
        'nav-machines',
        'nav-cupping',
        'nav-dashboard',
        'nav-schedule',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
    ]);

    await page.reload();
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveClass(/w-\[170px\]/);
    expect(await navOrder(page)).toEqual([
        'nav-history',
        'nav-roast',
        'nav-profiles',
        'nav-machines',
        'nav-cupping',
        'nav-dashboard',
        'nav-schedule',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
    ]);

    await page.getByTestId('nav-roast').click();
    await expect(sidebar).toHaveClass(/w-\[170px\]/);
    await expect(sidebar).not.toHaveClass(/w-\[68px\]/);

    await sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await expect(sidebar).toHaveClass(/w-\[68px\]/);
    await expect(sidebar.getByText('Roasting', { exact: true })).toBeHidden();
    await expect(sidebar.getByText('Operations', { exact: true })).toBeHidden();

    await page.reload();
    await expect(sidebar).toHaveClass(/w-\[68px\]/);
    await expect(sidebar.getByText('Roasting', { exact: true })).toBeHidden();

    await sidebar.locator('img[alt="First Crack"]').hover();
    await sidebar.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(sidebar).toHaveClass(/w-\[170px\]/);
    await expect(sidebar.getByText('Roasting', { exact: true })).toBeVisible();
    await page.reload();
    await expect(sidebar).toHaveClass(/w-\[170px\]/);
    expect(await navOrder(page)).toEqual([
        'nav-history',
        'nav-roast',
        'nav-profiles',
        'nav-machines',
        'nav-cupping',
        'nav-dashboard',
        'nav-schedule',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
    ]);

    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('button', { name: 'Hide Cupping', exact: true }).click();
    for (const name of ['Dashboard', 'Roast Schedule', 'Bean Inventory', 'Orders', 'Margin Calculator']) {
        await settings.getByRole('button', { name: `Hide ${name}`, exact: true }).click();
    }
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();

    await expect(page.getByTestId('nav-cupping')).toHaveCount(0);
    await expect(sidebar.getByText('Operations', { exact: true })).toHaveCount(0);
    await expect(sidebar.getByText('Roasting', { exact: true })).toBeVisible();
    expect(await navOrder(page)).toEqual(['nav-history', 'nav-roast', 'nav-profiles', 'nav-machines']);

    await page.reload();
    await expect(page.getByTestId('nav-cupping')).toHaveCount(0);
    await expect(sidebar.getByText('Operations', { exact: true })).toHaveCount(0);
    await expect(sidebar).toHaveClass(/w-\[170px\]/);

    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('button', { name: 'Reset sidebar', exact: true }).click();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    expect(await navOrder(page)).toEqual([
        'nav-roast',
        'nav-history',
        'nav-profiles',
        'nav-machines',
        'nav-cupping',
        'nav-dashboard',
        'nav-schedule',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
    ]);
    await expect(sidebar.getByText('Operations', { exact: true })).toBeVisible();
});
