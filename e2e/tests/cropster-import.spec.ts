import type { Page } from '@playwright/test';
import type { CropsterSettingsSnapshot } from '../../src/shared/types/cropster';
import { expect, test } from '../fixtures/app';
import { installPersistentStore } from '../fixtures/persistent-store';
import { mockTauriCommand } from '../fixtures/tauri-stub';

test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });

const snapshot = (): CropsterSettingsSnapshot => ({
    status: 'found',
    source: { product: 'Cropster', version: '5.13', sourceId: 'default' },
    machine: {
        version: '5.13',
        sources: {
            GenericModbusTcpSourceFactory: {
                host: '192.0.2.60',
                port: '502',
                temperatureUnit: 'CELSIUS',
                bigEndian: 'true',
                storageFormatTemperature: 'DECIMAL1_16',
                beanTemperatureRegister: '1000',
                exhaustTemperatureRegister: '1001',
                filter: 'false',
            },
        },
        channels: ['beanTemperature', 'exhaustTemperature'].map((name) => ({
            name,
            sourceFactory: 'org.cropster.roastingintelligence.measurement.impl.GenericModbusTcpSourceFactory',
            type: 'Default',
            offset: 0,
        })),
    },
    preferences: {
        version: '5.13',
        temperatureUnit: 'CELSIUS',
        minTemp: 50,
        maxTemp: 250,
        time: 720,
        minRiseRate: -5,
        maxRiseRate: 20,
        ror: 30,
    },
});
const openImporter = async (page: Page) => {
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    await settings.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('Cropster');
    await settings.getByRole('combobox', { name: 'Import from', exact: true }).selectOption('Cropster');
    await expect(settings.getByRole('heading', { name: 'Import Cropster settings', exact: true })).toBeVisible();
    return settings;
};

test('imports Cropster default-folder machine and graph settings without connecting hardware', async ({
    authedPage: page,
}, testInfo) => {
    let connections = 0;
    await mockTauriCommand(page, 'read_cropster_settings', snapshot);
    await page.route('http://127.0.0.1:9999/connect', (route) => {
        connections += 1;
        return route.abort();
    });
    await installPersistentStore(page);
    let settings = await openImporter(page);
    await expect(settings.getByText('Cropster settings found in the default folder.', { exact: true })).toBeVisible();
    await expect(settings.getByRole('checkbox', { name: /Cropster Modbus/ })).not.toBeChecked();
    await settings.getByText('View settings that will change', { exact: true }).click();
    const ror = settings.getByRole('row', { name: /Maximum RoR/ });
    await expect(ror.getByText('40 °C/min', { exact: true })).toBeVisible();
    await settings.getByRole('checkbox', { name: /Cropster Modbus/ }).check();
    await settings.getByRole('button', { name: 'Import 1 machine and graph', exact: true }).click();
    await expect(settings.getByText('Selected settings imported.', { exact: true })).toBeVisible();
    const machine = await page.evaluate(() => JSON.parse(localStorage.getItem('fc_machines') ?? '{}'));
    expect(machine.state.machines).toHaveLength(1);
    expect(machine.state.machines[0]).toMatchObject({
        importSource: { product: 'Cropster', sourceId: 'default' },
        pid: null,
        capabilities: [],
        connectionParams: {
            mode: 'tcp',
            host: '192.0.2.60',
            port: 502,
            modbus_registers: {
                BT: { register: 1000, func: 3, unit_id: 1, signed: false, div: 1 },
                ET: { register: 1001, func: 3, unit_id: 1, signed: false, div: 1 },
            },
        },
    });
    const graph = await page.evaluate(() => JSON.parse(localStorage.getItem('e2e:tauri-store:settings.json') ?? '{}'));
    expect(graph['roast.settings']).toMatchObject({
        tempMinC: 50,
        tempMaxC: 250,
        timeRangeMin: 12,
        rorYMin: -10,
        rorYMax: 40,
    });
    expect(connections).toBe(0);
    await page.setViewportSize({ width: 600, height: 900 });
    expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('cropster-import.png'), animations: 'disabled' });
    settings = await openImporter(page);
    await expect(settings.getByRole('checkbox', { name: /Cropster Modbus/ })).toBeDisabled();
    await expect(settings.getByText('Already imported', { exact: true })).toBeVisible();
    expect(connections).toBe(0);
});

test('keeps graph import available while blocking filtered readings and unverified settings', async ({
    authedPage: page,
}) => {
    let data = snapshot();
    const sources = data.machine?.sources as Record<string, Record<string, unknown>>;
    sources.GenericModbusTcpSourceFactory.filter = 'true';
    await mockTauriCommand(page, 'read_cropster_settings', () => data);
    const settings = await openImporter(page);
    await expect(settings.getByRole('checkbox', { name: /Cropster Modbus/ })).toBeDisabled();
    await expect(
        settings.getByText('Sensor corrections or filters cannot be carried over. Manual setup is required.', {
            exact: true,
        }),
    ).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Import graph settings', exact: true })).toBeEnabled();
    data = snapshot();
    if (data.machine) data.machine.version = '5.14';
    if (data.preferences) data.preferences.version = '5.14';
    data.source.version = '5.14';
    await settings.getByRole('button', { name: 'Search again', exact: true }).click();
    await expect(settings.getByRole('checkbox', { name: /Cropster Modbus/ })).toBeDisabled();
    await expect(settings.getByRole('button', { name: 'Import selected settings', exact: true })).toBeDisabled();
});

test('rescans closed Cropster and supports graph-only files with their own version', async ({ authedPage: page }) => {
    let closed = false;
    await mockTauriCommand(page, 'read_cropster_settings', () =>
        closed
            ? { ...snapshot(), machine: null }
            : { ...snapshot(), status: 'needs-app-closed', machine: null, preferences: null },
    );
    const settings = await openImporter(page);
    await expect(settings.getByText('Quit Cropster RI completely, then search again.', { exact: true })).toBeVisible();
    closed = true;
    await settings.getByRole('button', { name: 'Search again', exact: true }).click();
    await expect(settings.getByRole('checkbox', { name: /Cropster Modbus/ })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: 'Import graph settings', exact: true })).toBeEnabled();
});
