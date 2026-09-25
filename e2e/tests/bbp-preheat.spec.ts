import { expect, goNav, test } from '../fixtures/app';

test('first-batch preheat is chart-only and reload starts the curve at zero', async ({ authedPage: page }) => {
    await goNav(page, 'roast');
    const status = page.getByTestId('bbp-target-status');
    await expect(status).toBeVisible({ timeout: 20_000 });
    await expect(status).toContainText('Time since preheat start');
    await expect(status).not.toContainText('Time from previous End');
    await expect(page.getByTestId('bbp-timer')).toHaveCount(0);
    await expect(page.getByText('PREHEATING')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('fc_bbp_live'))).toBeNull();
    await page.screenshot({ path: '/tmp/bbp-preheat-no-timer.png' });

    // The roast view is in-memory. A document reload returns to the dashboard, then Active Roast.
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 20_000 });
    await goNav(page, 'roast');
    await expect(status).toBeVisible({ timeout: 20_000 });
    await expect(status).toContainText('Time since preheat start');
    await expect(page.getByTestId('bbp-timer')).toHaveCount(0);
    await expect(page.getByText('PREHEATING')).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(Number(await status.getAttribute('data-bbp-elapsed'))).toBeLessThan(15);
    expect(await page.evaluate(() => localStorage.getItem('fc_bbp_live'))).toBeNull();
});
