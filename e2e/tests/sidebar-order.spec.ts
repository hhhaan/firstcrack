import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/app';

const navOrder = async (page: Page) =>
    page.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));

test('collapsed sidebar can be expanded with Tab, Enter, and Space', async ({ authedPage: page }) => {
    const sidebar = page.getByTestId('app-sidebar');
    for (const key of ['Enter', 'Space']) {
        await sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
        await page.mouse.move(1000, 700);
        await page.evaluate(() => {
            (document.activeElement as HTMLElement)?.blur();
        });
        const expand = sidebar.getByRole('button', { name: 'Expand sidebar', exact: true });
        await expect(expand).toHaveAttribute('aria-expanded', 'false');
        for (let i = 0; i < 20 && !(await expand.evaluate((el) => el === document.activeElement)); i++) {
            await page.keyboard.press('Tab');
        }
        await expect(expand).toBeFocused();
        await expect(expand).toHaveCSS('opacity', '1');
        await page.keyboard.press(key);

        await expect(sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true })).toHaveAttribute(
            'aria-expanded',
            'true',
        );
    }
});

test('sidebar order is edited in general settings and roast collapses it', async ({ authedPage: page }) => {
    const sidebar = page.getByTestId('app-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
    );
    await expect(sidebar.getByText('Roasting & Quality', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Operations', { exact: true })).toBeVisible();
    expect(await navOrder(page)).toEqual([
        'nav-dashboard',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
        'nav-schedule',
        'nav-roast',
        'nav-history',
        'nav-profiles',
        'nav-cupping',
        'nav-machines',
    ]);

    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    await expect(settings.getByRole('heading', { name: 'Sidebar', exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Move Active Roast down', exact: true }).click();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();

    await expect(sidebar).toBeVisible();
    expect(await navOrder(page)).toEqual([
        'nav-dashboard',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
        'nav-schedule',
        'nav-history',
        'nav-roast',
        'nav-profiles',
        'nav-cupping',
        'nav-machines',
    ]);

    await page.reload();
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
    );
    expect(await navOrder(page)).toEqual([
        'nav-dashboard',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
        'nav-schedule',
        'nav-history',
        'nav-roast',
        'nav-profiles',
        'nav-cupping',
        'nav-machines',
    ]);

    await page.getByTestId('nav-roast').click();
    await expect(sidebar.getByRole('button', { name: 'Expand sidebar', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
    );

    await sidebar.getByRole('button', { name: 'Expand sidebar', exact: true }).hover();
    await sidebar.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
    );

    await sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await expect(sidebar.getByRole('button', { name: 'Expand sidebar', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
    );
    await expect(sidebar.getByText('Roasting & Quality', { exact: true })).toBeHidden();
    await expect(sidebar.getByText('Operations', { exact: true })).toBeHidden();

    await page.reload();
    await expect(sidebar.getByRole('button', { name: 'Expand sidebar', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
    );
    await expect(sidebar.getByText('Roasting & Quality', { exact: true })).toBeHidden();

    await sidebar.getByRole('button', { name: 'Expand sidebar', exact: true }).hover();
    await sidebar.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
    );
    await expect(sidebar.getByText('Roasting & Quality', { exact: true })).toBeVisible();
    await page.reload();
    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
    );
    expect(await navOrder(page)).toEqual([
        'nav-dashboard',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
        'nav-schedule',
        'nav-history',
        'nav-roast',
        'nav-profiles',
        'nav-cupping',
        'nav-machines',
    ]);

    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('button', { name: 'Hide Cupping', exact: true }).click();
    for (const name of ['Dashboard', 'Roast Schedule', 'Bean Inventory', 'Orders', 'Margin Calculator']) {
        await settings.getByRole('button', { name: `Hide ${name}`, exact: true }).click();
    }
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();

    await expect(page.getByTestId('nav-cupping')).toHaveCount(0);
    await expect(sidebar.getByText('Operations', { exact: true })).toHaveCount(0);
    await expect(sidebar.getByText('Roasting & Quality', { exact: true })).toBeVisible();
    expect(await navOrder(page)).toEqual(['nav-history', 'nav-roast', 'nav-profiles', 'nav-machines']);

    await page.reload();
    await expect(page.getByTestId('nav-cupping')).toHaveCount(0);
    await expect(sidebar.getByText('Operations', { exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
    );

    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('button', { name: 'Reset sidebar', exact: true }).click();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    expect(await navOrder(page)).toEqual([
        'nav-dashboard',
        'nav-beans',
        'nav-orders',
        'nav-pricing',
        'nav-schedule',
        'nav-roast',
        'nav-history',
        'nav-profiles',
        'nav-cupping',
        'nav-machines',
    ]);
    await expect(sidebar.getByText('Operations', { exact: true })).toBeVisible();
});
