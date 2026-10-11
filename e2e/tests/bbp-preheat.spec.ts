import { expect, goNav, test } from '../fixtures/app';

// Keep preheat tests independent of a desktop sidecar already listening on this port.
test.beforeEach(async ({ page }) => {
    await page.route('http://127.0.0.1:9999/**', (route) =>
        route.fulfill({
            json:
                new URL(route.request().url()).pathname === '/temperatures'
                    ? {
                          bt: 185,
                          et: 210,
                          ror: 0,
                          ror_et: 0,
                          heater: 70,
                          fan: 40,
                          drum: 55,
                          timestamp: Date.now() / 1000,
                      }
                    : { connected: true, roaster: 'virtual', capabilities: ['heater', 'fan', 'drum'], error: null },
            headers: { 'Access-Control-Allow-Origin': '*' },
        }),
    );
});

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

test('first-batch preheat keeps its curve and collects while another tab is open', async ({ authedPage: page }) => {
    await useWebPolling(page);
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 20_000 });
    await goNav(page, 'roast');
    const status = page.getByTestId('bbp-target-status');
    await expect(status).toBeVisible({ timeout: 20_000 });
    const readLive = () => page.evaluate(() => window.__FC_E2E__?.bbpLive?.());
    await expect.poll(async () => (await readLive())?.count ?? 0).toBeGreaterThan(2);
    const before = await readLive();
    expect(before).toBeDefined();

    for (const view of ['dashboard', 'beans']) {
        await goNav(page, view);
        await expect(status).toBeHidden();
        const hidden = await readLive();
        expect(hidden).toMatchObject({
            active: true,
            recording: false,
            startMs: before?.startMs,
            firstT: before?.firstT,
        });
        await expect.poll(async () => (await readLive())?.count ?? 0).toBeGreaterThan(hidden?.count ?? 0);

        await goNav(page, 'roast');
        await expect(status).toBeVisible();
        expect(await readLive()).toMatchObject({ startMs: before?.startMs, firstT: before?.firstT });
        expect(await curveSpan(page)).toBeGreaterThanOrEqual((before?.lastT ?? 0) - (before?.firstT ?? 0));
        await expect(page.getByTestId('bbp-timer')).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('fc_bbp_live'))).toBeNull();
    }
});

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
