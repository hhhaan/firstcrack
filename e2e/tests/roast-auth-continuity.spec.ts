import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test('revoked refresh token preserves recording, the running batch, and later Replay commands', async ({
    authedPage: page,
}) => {
    const commands: number[] = [];
    let heater = 70;
    await page.route('**/rest/v1/profiles?**', (route) =>
        route.fulfill({ json: { id: E2E_USER.id, email: E2E_USER.email, plan: 'pro_plus' } }),
    );
    await page.route('http://127.0.0.1:9999/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/control') {
            heater = route.request().postDataJSON().heater;
            commands.push(heater);
            return route.fulfill({ json: { ok: true, applied: { heater } } });
        }
        return route.fulfill({
            json:
                path === '/temperatures'
                    ? {
                          bt: 185,
                          bt_raw: 185,
                          et: 210,
                          et_raw: 210,
                          ror: 0,
                          ror_et: 0,
                          heater,
                          heater_set: heater,
                          fan: 40,
                          drum: 55,
                          timestamp: Date.now() / 1000,
                          pid: { state: 'off' },
                      }
                    : {
                          connected: true,
                          roaster: 'virtual',
                          machine_id: '__virtual__',
                          connection_epoch: 1,
                          capabilities: ['heater', 'fan', 'drum'],
                          control: { writable: true, limits: { heater: { min: 0, max: 100, unit: '%' } } },
                      },
        });
    });
    await page.route('**/rest/v1/roast_profiles?**', (route) =>
        route.fulfill({
            json: [
                {
                    id: 'auth-reference',
                    user_id: E2E_USER.id,
                    name: 'Continuity reference',
                    duration_sec: 600,
                    drop_temp_celsius: 200,
                    source_session: {
                        tsv_path: null,
                        duration_seconds: 600,
                        machine_roaster_key: 'virtual',
                        heater_events: [
                            { t: 0, bt: 185, heater: 60, trigger: 'time' },
                            { t: 8, bt: 185, heater: 40, trigger: 'time' },
                        ],
                    },
                },
            ],
        }),
    );
    // Deliver native polling ticks and observe writes through the real TSV writer.
    await page.addInitScript(() => {
        const original = window.__TAURI_INTERNALS__.invoke;
        const timers = new Map<number, ReturnType<typeof setInterval>>();
        window.__TAURI_INTERNALS__.invoke = async (command, args) => {
            if (command === 'plugin:event|listen' && args?.event === 'sidecar-poll-tick') {
                const id = Number(args.handler);
                timers.set(
                    id,
                    setInterval(() => {
                        const callback = Reflect.get(window, `_${id}`);
                        if (typeof callback === 'function') callback({ event: 'sidecar-poll-tick' });
                    }, 500),
                );
                return id;
            }
            if (command === 'plugin:event|unlisten') {
                clearInterval(timers.get(Number(args?.eventId)));
                timers.delete(Number(args?.eventId));
            }
            if (command === 'plugin:fs|write_text_file') {
                Reflect.set(window, '__continuityWrites', (Reflect.get(window, '__continuityWrites') ?? 0) + 1);
            }
            return original(command, args);
        };
    });
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await goNav(page, 'roast');
    await page.getByRole('button', { name: 'Target:' }).click();
    await page.getByRole('button', { name: 'Continuity reference', exact: true }).click();
    await page.evaluate(() => window.__FC_E2E__?.forceChargedSession());
    const replay = page.getByRole('checkbox', { name: 'Replay', exact: false });
    await expect(replay).toBeEnabled();
    await replay.check();
    await expect.poll(() => commands).toContain(60);
    const endButton = await page.getByTestId('roast-end').elementHandle();
    const before = await page.evaluate(async () => {
        const path = '/src/features/active-roast/model/status.ts';
        const { useRoastingStore } = await import(path);
        const state = useRoastingStore.getState();
        return { sessionId: state.sessionId, count: state.livePoints.length, elapsed: state.elapsed };
    });
    const writesBefore = await page.evaluate(() => Number(Reflect.get(window, '__continuityWrites')));

    await page.route('**/auth/v1/token?grant_type=refresh_token', (route) =>
        route.fulfill({
            status: 400,
            json: { error_code: 'refresh_token_not_found', message: 'Refresh token revoked' },
        }),
    );
    const error = await page.evaluate(async () => {
        const path = '/src/shared/lib/supabase.ts';
        const { supabase } = await import(path);
        return (await supabase.auth.refreshSession()).error?.status;
    });
    expect(error).toBe(400);
    await expect(page.getByRole('status')).toContainText('Roast controls and local recording continue.');
    await expect(replay).toBeChecked();
    expect(await endButton?.evaluate((element) => element.isConnected)).toBe(true);
    await expect.poll(() => commands).toContain(40);
    const after = await page.evaluate(async () => {
        const path = '/src/features/active-roast/model/status.ts';
        const { useRoastingStore } = await import(path);
        const state = useRoastingStore.getState();
        return { sessionId: state.sessionId, count: state.livePoints.length, elapsed: state.elapsed };
    });
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.count).toBeGreaterThan(before.count);
    expect(after.elapsed).toBeGreaterThan(before.elapsed);
    expect(await page.evaluate(() => Number(Reflect.get(window, '__continuityWrites')))).toBeGreaterThan(writesBefore);
    await expect(page.getByTestId('roast-end')).toBeEnabled();

    const setpoint = page.getByRole('textbox', { name: 'Heater setpoint value' });
    await replay.uncheck();
    await setpoint.fill('35');
    await setpoint.press('Enter');
    await expect.poll(() => commands).toContain(35);
});
