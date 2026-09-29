import { expect, goNav, test } from '../fixtures/app';

test('machine link notice survives screen changes and re-arms only after a healthy reading', async ({ authedPage: page }) => {
    let connected = true;
    let failing = false;
    let liveReadings = 0;
    await page.route('http://127.0.0.1:9999/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/temperatures' && failing) return route.abort('failed');
        if (path === '/disconnect') connected = false;
        if (path === '/connect') connected = true;
        const body =
            path === '/temperatures'
                ? {
                      bt: connected ? 210 : null,
                      et: 230,
                      ror: 0,
                      ror_et: 0,
                      heater: 0,
                      fan: 0,
                      drum: 0,
                      timestamp: 10,
                      stale: false,
                      reconnecting: false,
                  }
                : { connected, reconnecting: false, roaster: 'virtual', capabilities: ['heater'], error: null };
        await route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*' } });
        if (path === '/temperatures') liveReadings += 1;
    });
    // Exercise browser timers; the fixture's Tauri stub cannot emit native polling ticks.
    await page.evaluate(() => {
        delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });
    await goNav(page, 'machines');
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
    await expect.poll(() => liveReadings).toBeGreaterThan(0);
    const notice = page.getByRole('alert').filter({ hasText: 'Machine connection is unstable.' });

    failing = true;
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await notice.getByRole('button', { name: 'Close', exact: true }).click();
    await goNav(page, 'roast');
    await goNav(page, 'machines');
    await page.waitForTimeout(6500);
    await expect(notice).toHaveCount(0);

    const beforeRecovery = liveReadings;
    failing = false;
    await expect.poll(() => liveReadings).toBeGreaterThan(beforeRecovery);
    failing = true;
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await notice.getByRole('button', { name: 'Close', exact: true }).click();

    failing = false;
    await expect.poll(() => liveReadings).toBeGreaterThan(beforeRecovery + 1);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.waitForTimeout(3500);
    await expect(notice).toHaveCount(0);
});
