import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

for (const model of [
    { key: 'giesen_w1', name: 'Giesen W1A', airflow: [80, 150], drum: [35, 60] },
    { key: 'giesen_w45a_w60a', name: 'Giesen W60A', airflow: [100, 170], drum: [40, 55] },
]) {
    test(`${model.name} Active Roast sends pressure and drum commands independently`, async ({
        authedPage: page,
    }, testInfo) => {
        await page.setViewportSize({ width: 1600, height: 1000 });
        await page.addInitScript(() => {
            const nativeInvoke = window.__TAURI_INTERNALS__.invoke;
            window.__TAURI_INTERNALS__.invoke = (command, args) => {
                // The browser fixture has no Rust timer; use the app's web polling fallback.
                if (command === 'plugin:event|listen' && args?.event === 'sidecar-poll-tick') {
                    return Promise.reject(new Error('No native poll timer in browser test'));
                }
                return nativeInvoke(command, args);
            };
        });
        const feedback = { heater: 70, fan: 120, drum: 50 };
        const commands: Record<string, number>[] = [];
        const readUnits = { heater: '%', fan: 'Pa', drum: 'Hz' };
        await page.route('**/rest/v1/profiles?*', (route) =>
            route.fulfill({ json: { id: E2E_USER.id, email: E2E_USER.email, plan: 'pro_plus', business_name: 'E2E' } }),
        );
        await page.route('http://127.0.0.1:9999/status', (route) =>
            route.fulfill({
                json: {
                    connected: true,
                    roaster: model.key,
                    display_name: model.name,
                    brand: 'Giesen',
                    machine_id: `e2e-${model.key}`,
                    connection_epoch: 1,
                    capabilities: ['heater', 'fan', 'drum'],
                    read_units: readUnits,
                    error: null,
                    control: {
                        writable: true,
                        limits: {
                            heater: { min: 0, max: 100, unit: '%', verify_readback: true },
                            fan: { min: model.airflow[0], max: model.airflow[1], unit: 'Pa' },
                            drum: { min: model.drum[0], max: model.drum[1], unit: 'Hz' },
                        },
                    },
                },
            }),
        );
        await page.route('http://127.0.0.1:9999/temperatures', (route) =>
            route.fulfill({
                json: {
                    ...feedback,
                    bt: 185.2,
                    et: 210.5,
                    ror: 8.1,
                    ror_et: 5.2,
                    timestamp: Date.now() / 1000,
                    processing: { read_units: readUnits },
                },
            }),
        );
        await page.route('http://127.0.0.1:9999/control', (route) => {
            const command = route.request().postDataJSON() as Record<string, number>;
            commands.push(command);
            Object.assign(feedback, command);
            return route.fulfill({ json: { ok: true, applied: command } });
        });
        await page.reload();
        await goNav(page, 'roast');
        await page.waitForFunction(() => Boolean(window.__FC_E2E__?.forceChargedSession));
        await page.evaluate(async () => {
            const base = '/src/features/active-roast/model/';
            const { updateRoastSettings } = await import(`${base}settings.ts`);
            updateRoastSettings({ autoChargeEnabled: false, autoDropEnabled: false, tempMinC: 80 });
            window.__FC_E2E__?.forceChargedSession();
        });

        const airflow = page.getByRole('textbox', { name: 'Airflow setpoint value', exact: true });
        const drum = page.getByRole('textbox', { name: 'Drum setpoint value', exact: true });
        await expect(airflow).toBeEnabled();
        await expect(airflow).toHaveValue('120');
        await expect(drum).toHaveValue('50');
        await expect(airflow.locator('..')).toContainText('Pa');
        await expect(drum.locator('..')).toContainText('Hz');

        // Simulated roast history for an actual Active Roast UI preview; no PLC connection.
        await page.evaluate(async () => {
            const base = '/src/features/active-roast/model/';
            const { useRoastingStore } = await import(`${base}status.ts`);
            useRoastingStore.setState({
                elapsed: 420,
                roastStartMs: Date.now() - 420_000,
                livePoints: Array.from({ length: 421 }, (_, t) => ({
                    time: t,
                    label: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`,
                    bt: t < 75 ? 95 + 100 * (1 - t / 75) ** 2 : 95 + 90.2 * ((t - 75) / 345) ** 0.7,
                    et: 200 + (10.5 * t) / 420,
                    ror: t < 75 ? null : 20 - (11.9 * (t - 75)) / 345,
                    ror_et: 5.2,
                    heater: 70,
                    fan: 120,
                    drum: 50,
                    processing: { read_units: { heater: '%', fan: 'Pa', drum: 'Hz' } },
                })),
            });
        });
        await expect(
            page
                .getByRole('region', { name: /^Temperature curve chart/ })
                .locator('canvas')
                .first(),
        ).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`${model.key}-active-roast.png`), animations: 'disabled' });

        await page.getByRole('button', { name: 'Airflow plus', exact: true }).click();
        await expect.poll(() => commands).toEqual([{ fan: 121 }]);
        await expect(airflow).toHaveValue('121');
        await page.getByRole('button', { name: 'Drum plus', exact: true }).click();
        await expect.poll(() => commands).toEqual([{ fan: 121 }, { drum: 51 }]);
        await expect(drum).toHaveValue('51');

        await airflow.fill('999');
        await airflow.press('Enter');
        await expect.poll(() => commands.at(-1)).toEqual({ fan: model.airflow[1] });
        await drum.fill('0');
        await drum.press('Enter');
        await expect.poll(() => commands.at(-1)).toEqual({ drum: model.drum[0] });
        expect(commands.every((command) => !('heater' in command))).toBe(true);
    });
}
