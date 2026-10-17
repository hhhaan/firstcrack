import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test.beforeEach(async ({ authedPage: page }) => {
    await page.route('**/rest/v1/profiles*', (route) =>
        route.fulfill({
            json: { id: E2E_USER.id, plan: 'pro', business_name: 'E2E Roastery', simulator_enabled: true },
        }),
    );
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
});

test('Machines disconnect button respects the in-progress roast confirmation', async ({ authedPage: page }) => {
    let connected = true;
    let disconnects = 0;
    await page.route('http://127.0.0.1:9999/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/disconnect') {
            disconnects += 1;
            connected = false;
        }
        await route.fulfill({
            json:
                path === '/temperatures'
                    ? { bt: 185, et: 210, ror: 0, heater: 70, timestamp: Date.now() / 1000 }
                    : { connected, roaster: 'virtual', machine_id: '__virtual__', capabilities: ['heater'] },
        });
    });
    await goNav(page, 'roast');
    await page.waitForFunction(() => Boolean(window.__FC_E2E__?.forceChargedSession));
    await page.evaluate(() => {
        window.__FC_E2E__?.forceChargedSession();
        Object.assign(window, {
            '__e2e_plugin:dialog|message': () => {
                Object.assign(window, { __e2e_disconnect_prompted: true });
                return '취소';
            },
        });
    });
    await goNav(page, 'machines');
    const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true });
    await expect(disconnect).toBeVisible();
    await disconnect.click();
    await page.waitForFunction(() => '__e2e_disconnect_prompted' in window);
    await expect(disconnect).toBeVisible();
    expect(disconnects).toBe(0);
    await page.evaluate(() => {
        Object.assign(window, {
            '__e2e_plugin:dialog|message': () => '연결 해제',
        });
    });
    await disconnect.click();
    await expect.poll(() => disconnects).toBe(1);
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
});

test('machine link notice survives screen changes and re-arms only after a healthy reading', async ({
    authedPage: page,
}) => {
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
                : {
                      connected,
                      reconnecting: false,
                      roaster: 'virtual',
                      machine_id: connected ? '__virtual__' : null,
                      connection_epoch: 1,
                      capabilities: ['heater'],
                      error: null,
                  };
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
