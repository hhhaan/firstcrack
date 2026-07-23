import { expect, goNav, test } from '../fixtures/app';

test.describe('2a authenticated shell', () => {
    test('reaches primary workspace view (dashboard)', async ({ authedPage: page }) => {
        await expect(page.getByTestId('app-sidebar')).toBeVisible();
        await expect(page.getByTestId('dashboard-greeting')).toBeVisible();
        await goNav(page, 'beans');
        await expect(page.getByTestId('beans-add-lot')).toBeVisible();
        await goNav(page, 'dashboard');
        await expect(page.getByTestId('dashboard-header')).toBeVisible();
    });
});
