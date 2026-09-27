import { expect, goNav, test } from '../fixtures/app';

/** Browser `pnpm dev` polls with setInterval. The e2e Tauri stub would wait for a tick that never fires. */
const useWebPolling = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(() => {
        delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });
};

test('first-batch preheat is chart-only and reload starts the curve at zero', async ({ authedPage: page }) => {
    await goNav(page, 'roast');
    const status = page.getByTestId('bbp-target-status');
    await expect(status).toBeVisible({ timeout: 20_000 });
    await expect(status).not.toContainText('Time since preheat start');
    await expect(status).not.toContainText('Live BBP');
    await expect(page.getByTestId('bbp-timer')).toHaveCount(0);
    await expect(page.getByText('PREHEATING')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('fc_bbp_live'))).toBeNull();
    await page.screenshot({ path: '/tmp/bbp-preheat-no-timer.png' });

    // The roast view is in-memory. A document reload returns to the dashboard, then Active Roast.
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 20_000 });
    await goNav(page, 'roast');
    await expect(status).toBeVisible({ timeout: 20_000 });
    await expect(status).not.toContainText('Time since preheat start');
    await expect(page.getByTestId('bbp-timer')).toHaveCount(0);
    await expect(page.getByText('PREHEATING')).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(Number(await status.getAttribute('data-bbp-elapsed'))).toBeLessThan(15);
    expect(await page.evaluate(() => localStorage.getItem('fc_bbp_live'))).toBeNull();
});

const curveSpan = async (page: import('@playwright/test').Page) =>
    Number(await page.getByTestId('bbp-target-status').getAttribute('data-bbp-span'));

test('reload during first-batch preheat restarts the curve near zero', async ({ authedPage: page }) => {
    await useWebPolling(page);
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 20_000 });
    await goNav(page, 'roast');
    const status = page.getByTestId('bbp-target-status');
    await expect(status).toBeVisible({ timeout: 20_000 });
    await expect
        .poll(async () => Number(await status.getAttribute('data-bbp-elapsed')), { timeout: 40_000 })
        .toBeGreaterThan(20);
    const before = await page.evaluate(() => window.__FC_E2E__?.bbpLive?.());

    await page.reload();
    expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type)).toBe('reload');
    await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 20_000 });
    await goNav(page, 'roast');
    await expect(status).toBeVisible({ timeout: 20_000 });
    await expect(status).not.toContainText('Time since preheat start');
    await expect(page.getByTestId('bbp-timer')).toHaveCount(0);
    await expect.poll(() => curveSpan(page), { timeout: 5_000 }).toBeLessThan(5);
    expect(Number(await status.getAttribute('data-bbp-elapsed'))).toBeLessThan(5);
    const after = await page.evaluate(() => window.__FC_E2E__?.bbpLive?.());
    expect(after?.startMs).toBeGreaterThan(before?.startMs ?? 0);
    expect(await page.evaluate(() => localStorage.getItem('fc_bbp_live'))).toBeNull();
});

test('a new React tree during first-batch preheat restarts the curve near zero', async ({ authedPage: page }) => {
    await useWebPolling(page);
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 20_000 });
    await goNav(page, 'roast');
    const status = page.getByTestId('bbp-target-status');
    await expect(status).toBeVisible({ timeout: 20_000 });
    await expect
        .poll(async () => Number(await status.getAttribute('data-bbp-elapsed')), { timeout: 20_000 })
        .toBeGreaterThan(4);

    await page.evaluate(() => window.__FC_E2E__?.remountRoast?.());
    await expect(status).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('bbp-timer')).toHaveCount(0);
    await expect.poll(() => curveSpan(page), { timeout: 5_000 }).toBeLessThan(5);
    expect(Number(await status.getAttribute('data-bbp-elapsed'))).toBeLessThan(5);
    expect(await page.evaluate(() => localStorage.getItem('fc_bbp_live'))).toBeNull();
});
