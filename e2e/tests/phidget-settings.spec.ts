import type { Page } from '@playwright/test';
import { chooseSelect, expect, goNav, test } from '../fixtures/app';

async function openPhidget(page: Page, model: string) {
    await goNav(page, 'machines');
    await page.getByRole('button', { name: 'Add Machine', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Select a roaster...', exact: true }).first().click();
    await dialog.getByRole('combobox', { name: 'Search brand or model' }).fill(model);
    await dialog.getByRole('option', { name: new RegExp(`^Phidget ${model}`) }).click();
    return dialog;
}

test.beforeEach(async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 1260, height: 810 });
    await page.route('http://127.0.0.1:9999/**', (route) =>
        route.fulfill({
            json: route.request().url().includes('serial-ports')
                ? []
                : { connected: false, roaster: null, capabilities: [] },
        }),
    );
});

test('model search finds TMP1101 and disabled ET survives saving and editing', async ({
    authedPage: page,
}, testInfo) => {
    const dialog = await openPhidget(page, 'TMP1101');
    await expect(dialog.getByRole('group', { name: 'BT', exact: true })).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'ET', exact: true })).toBeVisible();
    await dialog.getByRole('switch', { name: 'Use ET' }).uncheck();
    await expect(dialog.getByRole('group', { name: 'ET', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Add Machine', exact: true }).click();
    await expect(dialog).toBeHidden();
    const params = await page.evaluate(
        () => JSON.parse(localStorage.getItem('fc_machines') ?? '{}').state.machines[0].connectionParams,
    );
    expect(params.channel_et).toBeNull();
    await goNav(page, 'machines');
    await page.getByText('Phidget TMP1101 (4x TC)', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Edit connection settings' }).click();
    await expect(dialog.getByRole('switch', { name: 'Use ET' })).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
    await dialog.screenshot({ path: testInfo.outputPath('phidget-et-disabled-1260x810.png') });
});

test('independent RTD modules preserve addresses and probe wiring', async ({ authedPage: page }, testInfo) => {
    const dialog = await openPhidget(page, 'TMP1202');
    const bt = dialog.getByRole('group', { name: 'BT', exact: true });
    await bt.getByLabel('Serial number (optional)').fill('12345');
    await bt.getByLabel('Hub port (optional, 0–5)').fill('0');
    await chooseSelect(bt.getByLabel('RTD type'), 'PT100_3850');
    await chooseSelect(bt.getByLabel('RTD wires'), '3');
    await expect(bt.getByLabel('Thermocouple type')).toHaveCount(0);
    await dialog.getByRole('switch', { name: 'Use ET' }).check();
    const et = dialog.getByRole('group', { name: 'ET', exact: true });
    await chooseSelect(et.getByLabel('Model'), 'TMP1200');
    await et.getByLabel('Serial number (optional)').fill('12345');
    await et.getByLabel('Hub port (optional, 0–5)').fill('1');
    await expect(et.getByLabel('Channel')).toHaveAttribute('data-value', '0');
    await page.setViewportSize({ width: 1024, height: 680 });
    await expect(dialog.getByRole('button', { name: 'Add Machine', exact: true })).toBeInViewport();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath('phidget-rtd-1024x680.png') });
    await dialog.getByRole('button', { name: 'Add Machine', exact: true }).click();
    await expect(dialog).toBeHidden();
    const params = await page.evaluate(
        () => JSON.parse(localStorage.getItem('fc_machines') ?? '{}').state.machines[0].connectionParams,
    );
    expect(params).toMatchObject({
        bt_device_type: 'TMP1202',
        bt_serial_number: 12345,
        bt_hub_port: 0,
        bt_rtd_type: 'PT100_3850',
        bt_rtd_wire_setup: 3,
        et_device_type: 'TMP1200',
        et_serial_number: 12345,
        et_hub_port: 1,
        channel_bt: 0,
        channel_et: 0,
    });
    await goNav(page, 'machines');
    await page.getByText('Phidget TMP1202 (1x RTD)', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Edit connection settings' }).click();
    await expect(
        dialog.getByRole('group', { name: 'ET', exact: true }).getByLabel('Hub port (optional, 0–5)'),
    ).toHaveValue('1');
});

test('connected status with null BT fails the test and disconnects', async ({ authedPage: page }) => {
    let disconnects = 0;
    await page.route('http://127.0.0.1:9999/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/disconnect') disconnects += 1;
        return route.fulfill({
            json:
                path === '/temperatures'
                    ? { bt: null, et: 20, et_raw: 20, stale: false, reconnecting: false }
                    : path === '/serial-ports'
                      ? []
                      : { connected: path !== '/disconnect', roaster: 'phidget_tmp1101', capabilities: [] },
        });
    });
    const dialog = await openPhidget(page, 'TMP1101');
    await dialog.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect(
        dialog.getByText('No valid live temperature. Check BT and any enabled ET probe, then test again.'),
    ).toBeVisible();
    expect(disconnects).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Add & Connect', exact: true })).toHaveCount(0);
});
