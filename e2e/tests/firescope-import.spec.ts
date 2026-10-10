import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/app';

const modbusMachine = (id: string, name: string, address = 1000) => ({
    id,
    name,
    connection: {
        driver: 'ModbusDriver',
        type: 'serial',
        protocol: 'modbus',
        serial: { type: 'rtu', path: '/dev/tty.synthetic', baudRate: 9600, dataBits: 8, stopBits: 2, parity: 'none' },
        modbus: [
            {
                label: 'bt',
                unit: '°C',
                sensorId: 1,
                address,
                read: 'FC4',
                type: 'integer',
                decimalPlace: 1,
                compensation: 0,
            },
            {
                label: 'et',
                unit: '°C',
                sensorId: 1,
                address: address + 1,
                read: 'FC4',
                type: 'integer',
                decimalPlace: 1,
                compensation: 0,
            },
        ],
    },
});

const snapshot = (machines: { sequence: number; current: boolean; settings: Record<string, unknown> }[]) => ({
    status: 'found' as const,
    source: { product: 'Firescope' as const, version: '1.0.2' },
    graphTemperatureUnit: '°C',
    graph: { yAxisStart: 50, yAxisEnd: 250, xAxisEnd: 720, xAxisScaleUnit: 60, btLineColor: '#44A56B' },
    indicator: { rorInterval: 60 },
    global: { temperature: '°C' },
    machines,
});

const unsupportedProbat = {
    id: 'probat-1',
    name: 'Unsupported Probat',
    connection: {
        driver: 'ProbatPlcDriver',
        type: 'ethernet',
        protocol: 'modbus',
        ethernet: { type: 'tcp', ip: '192.0.2.9', port: 502 },
        modbus: [],
    },
};

const installPersistentStore = async (page: Page) => {
    await page.addInitScript(() => {
        const internals = window.__TAURI_INTERNALS__ as unknown as {
            invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
        const fallback = internals.invoke.bind(internals);
        const storageKey = 'e2e:tauri-store:settings.json';
        let values: Record<string, unknown> = {};
        internals.invoke = async (cmd, args = {}) => {
            if (cmd === 'plugin:store|load') {
                values = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, unknown>;
                return 1;
            }
            if (cmd === 'plugin:store|get') {
                const key = String(args.key);
                return [values[key] ?? null, Object.hasOwn(values, key)];
            }
            if (cmd === 'plugin:store|set') {
                values[String(args.key)] = args.value;
                return null;
            }
            if (cmd === 'plugin:store|delete') {
                delete values[String(args.key)];
                return null;
            }
            if (cmd === 'plugin:store|save') {
                localStorage.setItem(storageKey, JSON.stringify(values));
                return null;
            }
            return fallback(cmd, args);
        };
    });
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
};

const openImporter = async (page: Page) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    await settings.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('Firescope');
    await expect(settings.getByRole('heading', { name: 'Import Firescope settings', exact: true })).toBeVisible();
    return settings;
};

test('imports Firescope machine and graph settings once without connecting hardware', async ({
    authedPage: page,
}, testInfo) => {
    let connectRequests = 0;
    await page.route('http://127.0.0.1:9999/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/imports/firescope') {
            return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(
                    snapshot([
                        { sequence: 10, current: true, settings: modbusMachine('modbus-1', 'Synthetic RTU') },
                        { sequence: 9, current: false, settings: unsupportedProbat },
                    ]),
                ),
            });
        }
        if (path === '/connect') connectRequests += 1;
        return route.abort();
    });
    await installPersistentStore(page);

    let settings = await openImporter(page);
    await expect(settings.getByText('Firescope settings found.', { exact: true })).toBeVisible();
    await settings.getByText('Preview graph mapping', { exact: true }).click();
    await expect(settings.getByRole('cell').filter({ hasText: 'tempMinC' })).toBeVisible();
    await settings.getByText('View connection and sensor address mapping', { exact: true }).first().click();
    await expect(settings.locator('pre').filter({ hasText: 'modbus_registers' })).toBeVisible();
    await expect(settings.getByRole('checkbox', { name: /Unsupported Probat/ })).toBeDisabled();
    await settings.getByRole('button', { name: 'Import selected settings', exact: true }).click();
    await expect(
        settings.getByText('Settings imported. Review connections in the machine list.', { exact: true }),
    ).toBeVisible();
    expect(connectRequests).toBe(0);

    const persistedMachines = await page.evaluate(() => JSON.parse(localStorage.getItem('fc_machines') ?? '{}'));
    expect(persistedMachines.state.machines).toHaveLength(1);
    expect(persistedMachines.state.machines[0]).toMatchObject({
        name: 'Synthetic RTU',
        importSource: { product: 'Firescope', sourceId: 'modbus-1' },
        connectionParams: { modbus_registers: { BT: { register: 1000, func: 4, signed: true, div: 1 } } },
    });
    const storedSettings = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('e2e:tauri-store:settings.json') ?? '{}'),
    );
    expect(storedSettings['roast.settings']).toMatchObject({ tempMinC: 50, tempMaxC: 250, timeRangeMin: 12 });

    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    settings = await openImporter(page);
    await expect(settings.getByRole('checkbox', { name: /Synthetic RTU Already imported/ })).toBeDisabled();
    await settings.getByRole('checkbox', { name: 'Graph and display settings', exact: true }).uncheck();
    await expect(settings.getByRole('button', { name: 'Import selected settings', exact: true })).toBeDisabled();
    const reloadedSettings = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('e2e:tauri-store:settings.json') ?? '{}'),
    );
    expect(reloadedSettings['roast.settings']).toMatchObject({ tempMinC: 50, tempMaxC: 250, timeRangeMin: 12 });
    expect(connectRequests).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('firescope-import-persisted.png'), animations: 'disabled' });
});

test('rescans after busy status and disables a two-machine import at the Pro limit', async ({
    authedPage: page,
}, testInfo) => {
    let scans = 0;
    let connectRequests = 0;
    await page.route('http://127.0.0.1:9999/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/imports/firescope') {
            scans += 1;
            const body =
                scans === 1
                    ? { ...snapshot([]), status: 'needs-app-closed' }
                    : snapshot([
                          { sequence: 20, current: true, settings: modbusMachine('modbus-2', 'Batch one') },
                          { sequence: 19, current: false, settings: modbusMachine('modbus-3', 'Batch two', 2000) },
                      ]);
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        }
        if (path === '/connect') connectRequests += 1;
        return route.abort();
    });
    await installPersistentStore(page);

    const settings = await openImporter(page);
    await expect(settings.getByText('Quit Firescope completely, then search again.', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Search again', exact: true }).click();
    await expect(settings.getByText('Firescope settings found.', { exact: true })).toBeVisible();
    await expect(settings.getByRole('checkbox', { name: /Batch one/ })).toBeVisible();
    await expect(settings.getByRole('checkbox', { name: /Batch two/ })).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Import selected settings', exact: true })).toBeDisabled();
    await expect(settings.getByRole('alert')).toBeVisible();
    expect(connectRequests).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('firescope-import-pro-limit.png'), animations: 'disabled' });
});

test('keeps saved graph settings when machine persistence fails', async ({ authedPage: page }) => {
    await page.route('http://127.0.0.1:9999/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/imports/firescope') {
            return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(
                    snapshot([{ sequence: 30, current: true, settings: modbusMachine('modbus-4', 'Write failure') }]),
                ),
            });
        }
        if (path === '/connect') throw new Error('Importer attempted a hardware connection');
        return route.abort();
    });
    await installPersistentStore(page);
    const settings = await openImporter(page);
    await expect(settings.getByText('Firescope settings found.', { exact: true })).toBeVisible();
    await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'fc_machines') throw new Error('synthetic machine persistence failure');
            return original.call(this, key, value);
        };
    });

    await settings.getByRole('button', { name: 'Import selected settings', exact: true }).click();
    await expect(
        settings.getByRole('alert').filter({
            hasText: 'Graph settings were saved, but machines could not be added. Retry the machine import.',
        }),
    ).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('fc_machines'))).toBeNull();
    const storedSettings = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('e2e:tauri-store:settings.json') ?? '{}'),
    );
    expect(storedSettings['roast.settings']).toMatchObject({ tempMinC: 50, tempMaxC: 250, timeRangeMin: 12 });
});

test('keeps previous graph settings when the settings store save fails', async ({ authedPage: page }) => {
    await page.route('http://127.0.0.1:9999/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/imports/firescope') {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot([])) });
        }
        if (path === '/connect') throw new Error('Importer attempted a hardware connection');
        return route.abort();
    });
    await page.evaluate(() => {
        localStorage.setItem(
            'e2e:tauri-store:settings.json',
            JSON.stringify({ 'roast.settings': { tempMinC: 10, tempMaxC: 300, timeRangeMin: 20 } }),
        );
    });
    await installPersistentStore(page);
    const settings = await openImporter(page);
    await expect(settings.getByText('Firescope settings found.', { exact: true })).toBeVisible();
    await page.evaluate(() => {
        const internals = window.__TAURI_INTERNALS__ as unknown as {
            invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
        const original = internals.invoke.bind(internals);
        internals.invoke = async (cmd, args) => {
            if (cmd === 'plugin:store|save') throw new Error('synthetic settings save failure');
            return original(cmd, args);
        };
    });

    await settings.getByRole('button', { name: 'Import selected settings', exact: true }).click();
    await expect(settings.getByRole('alert')).toHaveText(
        'Settings could not be saved. Existing machines were preserved.',
    );
    const storedSettings = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('e2e:tauri-store:settings.json') ?? '{}'),
    );
    expect(storedSettings['roast.settings']).toMatchObject({ tempMinC: 10, tempMaxC: 300, timeRangeMin: 20 });
    expect(await page.evaluate(() => localStorage.getItem('fc_machines'))).toBeNull();
});
