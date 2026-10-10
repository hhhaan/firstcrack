import type { Page } from '@playwright/test';
import type { ArtisanSettingsSnapshot } from '../../src/shared/types/artisan';
import { expect, test } from '../fixtures/app';
import { installPersistentStore } from '../fixtures/persistent-store';

const snapshot = (version: string | null = '4.2.0'): ArtisanSettingsSnapshot => ({
    status: 'found',
    source: { product: 'Artisan', version, sourceId: 'native' },
    settings: {
        'Device/id': 29,
        Mode: 'C',
        'Modbus/type': 3,
        'Modbus/host': '192.0.2.20',
        'Modbus/port': 502,
        'Modbus/input1deviceId': 1,
        'Modbus/input1register': 1000,
        'Modbus/input1code': 4,
        'Modbus/input1div': 1,
        'Modbus/input2deviceId': 1,
        'Modbus/input2register': 1001,
        'Modbus/input2code': 4,
        'Axis/ymin': 50,
        'Axis/ymax': 250,
        'Axis/xmin': 0,
        'Axis/xmax': 720,
        Colors: { bt: '#44a56b' },
    },
});

const openImporter = async (page: Page) => {
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    await settings.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('Artisan');
    await settings.getByRole('combobox', { name: 'Import from', exact: true }).selectOption('Artisan');
    await expect(settings.getByRole('heading', { name: 'Import Artisan settings', exact: true })).toBeVisible();
    return settings;
};

test('imports Artisan machine and graph settings once without connecting hardware', async ({
    authedPage: page,
}, testInfo) => {
    let connections = 0;
    await page.route('http://127.0.0.1:9999/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/imports/artisan') return route.fulfill({ json: snapshot() });
        if (path === '/connect') connections += 1;
        return route.abort();
    });
    await installPersistentStore(page);
    let settings = await openImporter(page);
    await expect(settings.getByText('Artisan settings found.', { exact: true })).toBeVisible();
    await expect(settings.getByRole('checkbox', { name: /Artisan Modbus/ })).not.toBeChecked();
    await settings.getByRole('checkbox', { name: /Artisan Modbus/ }).check();
    await settings.getByRole('button', { name: 'Import 1 machine and graph', exact: true }).click();
    await expect(settings.getByText('Selected settings imported.', { exact: true })).toBeVisible();
    expect(connections).toBe(0);
    const machineState = await page.evaluate(() => JSON.parse(localStorage.getItem('fc_machines') ?? '{}'));
    expect(machineState.state.machines).toHaveLength(1);
    expect(machineState.state.machines[0]).toMatchObject({
        importSource: { product: 'Artisan', sourceId: 'native' },
        protocol: 'modbus',
        connectionParams: {
            mode: 'tcp',
            host: '192.0.2.20',
            port: 502,
            modbus_registers: {
                BT: { register: 1000, func: 4, unit_id: 1, div: 1, signed: false },
                ET: { register: 1001, func: 4, unit_id: 1, div: 0, signed: false },
            },
        },
    });
    const storedSettings = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('e2e:tauri-store:settings.json') ?? '{}'),
    );
    expect(storedSettings['roast.settings']).toMatchObject({
        tempMinC: 50,
        tempMaxC: 250,
        timeRangeMin: 12,
        curveStyles: { bt: { color: '#44a56b' } },
    });
    await page.setViewportSize({ width: 600, height: 900 });
    expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('artisan-import.png'), animations: 'disabled' });
    settings = await openImporter(page);
    await expect(settings.getByRole('checkbox', { name: /Artisan Modbus/ })).toBeDisabled();
    await expect(settings.getByText('Already imported', { exact: true })).toBeVisible();
    expect(connections).toBe(0);
});

test('requires explicit version confirmation before reconstructing omitted machine defaults', async ({
    authedPage: page,
}) => {
    await page.route('http://127.0.0.1:9999/imports/artisan', (route) => route.fulfill({ json: snapshot(null) }));
    const settings = await openImporter(page);
    const machine = settings.getByRole('checkbox', { name: /Artisan Modbus/ });
    await expect(machine).toBeDisabled();
    const version = settings.getByRole('checkbox', { name: /I confirm these settings were saved by Artisan 4.2.0/ });
    await version.check();
    await expect(machine).toBeEnabled();
    await machine.check();
    await version.uncheck();
    await expect(machine).toBeDisabled();
    await expect(machine).not.toBeChecked();
    await settings.getByRole('combobox', { name: 'Import from', exact: true }).selectOption('Firescope');
    await settings.getByRole('combobox', { name: 'Import from', exact: true }).selectOption('Artisan');
    await expect(version).not.toBeChecked();
});

test('rescan after quitting Artisan and blocks configured sensor corrections', async ({ authedPage: page }) => {
    let closed = false;
    await page.route('http://127.0.0.1:9999/imports/artisan', (route) => {
        const data = snapshot();
        if (!closed) return route.fulfill({ json: { ...data, status: 'needs-app-closed', settings: null } });
        return route.fulfill({ json: { ...data, settings: { ...data.settings, BTfunction: 'x + 5' } } });
    });
    const settings = await openImporter(page);
    await expect(settings.getByText('Quit Artisan completely, then search again.', { exact: true })).toBeVisible();
    await expect(settings.getByRole('checkbox', { name: /Artisan Modbus/ })).toHaveCount(0);
    closed = true;
    await settings.getByRole('button', { name: 'Search again', exact: true }).click();
    await expect(settings.getByRole('checkbox', { name: /Artisan Modbus/ })).toBeDisabled();
    await expect(
        settings.getByText('Sensor corrections or formulas cannot be carried over. Manual setup is required.', {
            exact: true,
        }),
    ).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Import graph settings', exact: true })).toBeEnabled();
});
