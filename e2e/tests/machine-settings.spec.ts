import { expect, goNav, test } from '../fixtures/app';

for (const protocol of ['modbus', 's7']) {
    test(`${protocol} settings group channels and preserve collapsed values`, async ({
        authedPage: page,
    }, testInfo) => {
        await page.route('http://127.0.0.1:9999/**', (route) =>
            route.fulfill({
                json: route.request().url().includes('serial-ports')
                    ? []
                    : { connected: false, roaster: null, capabilities: [] },
            }),
        );
        await page.setViewportSize({ width: 1366, height: 768 });
        await goNav(page, 'machines');
        await page.getByRole('button', { name: 'Add Machine', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Other / Custom' }).click();
        await dialog.getByLabel('Machine name').fill('Firescope');
        await dialog.getByLabel('Brand', { exact: true }).fill('Firescope');
        await dialog.getByLabel('Protocol').selectOption(protocol);
        if (protocol === 'modbus') await dialog.getByRole('combobox', { name: /^Connection \*/ }).selectOption('tcp');
        await dialog.getByLabel('IP Address').fill('192.168.44.26');
        await dialog.getByLabel('Port', { exact: true }).fill(protocol === 'modbus' ? '502' : '102');
        if (protocol === 's7') {
            await dialog.getByLabel('Rack', { exact: true }).fill('0');
            await dialog.getByLabel('Slot', { exact: true }).fill('1');
        }

        const advanced = dialog
            .locator('details')
            .filter({ has: page.locator('summary', { hasText: 'Data format, units & scale' }) })
            .last();
        await expect(advanced).not.toHaveAttribute('open');
        await advanced.locator('summary').click();
        await dialog.getByLabel('BT Scale').selectOption('1');
        if (protocol === 'modbus') {
            await dialog.getByLabel('BT 32-bit Float').selectOption('true');
            await dialog.getByLabel('Float Word Order').selectOption('big');
        }
        await advanced.locator('summary').click();
        await dialog.getByRole('button', { name: 'Add Machine', exact: true }).click();
        await expect(dialog).toBeHidden();

        await page.getByText('Firescope', { exact: true }).first().click();
        const connectionDetails = page.getByRole('region', { name: 'Connection', exact: true });
        await expect(connectionDetails).toBeVisible();
        await expect(connectionDetails.getByText(/\[object Object\]/)).toHaveCount(0);
        await expect(connectionDetails.getByText('192.168.44.26', { exact: true })).toBeVisible();
        const details = connectionDetails.locator('details');
        await expect(details).not.toHaveAttribute('open');
        await expect(details.locator('dt').filter({ hasText: 'BT Scale' })).toBeHidden();
        await details.locator('summary').click();
        if (protocol === 's7') {
            await expect(
                details.getByRole('term').filter({ hasText: 'Rack' }).locator('..').getByRole('definition'),
            ).toHaveText('0');
            await expect(
                details.getByRole('term').filter({ hasText: 'Slot' }).locator('..').getByRole('definition'),
            ).toHaveText('1');
        }
        const btAddress = connectionDetails.getByRole('term').filter({
            hasText: protocol === 'modbus' ? 'BT Register' : 'BT DB',
        });
        await expect(btAddress.locator('..').getByRole('definition')).toHaveText(protocol === 'modbus' ? '0' : '3');
        await expect(
            connectionDetails.getByRole('term').filter({ hasText: 'BT Scale' }).locator('..').getByRole('definition'),
        ).toHaveText('÷10');
        await expect(connectionDetails.getByRole('heading', { name: 'ET', exact: true })).toHaveCount(0);
        await details.locator('summary').click();
        await page.screenshot({ path: testInfo.outputPath('connection-details.png') });
        await page.getByRole('button', { name: 'Edit connection settings' }).click();
        await expect(dialog).toBeVisible();
        const connection = await dialog.getByRole('region', { name: 'Connection settings' }).boundingBox();
        const addresses = await dialog.locator('details').first().boundingBox();
        if (!connection || !addresses) throw new Error('Settings panels must be visible');
        expect(addresses.x).toBeGreaterThan(connection.x + connection.width);
        expect(addresses.y).toBe(connection.y);
        await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
        await dialog.screenshot({ path: testInfo.outputPath('desktop.png') });

        await page.setViewportSize({ width: 520, height: 820 });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await dialog.evaluate((element) =>
            Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
        );
        const stackedConnection = await dialog.getByRole('region', { name: 'Connection settings' }).boundingBox();
        const stackedAddresses = await dialog.locator('details').first().boundingBox();
        if (!stackedConnection || !stackedAddresses) throw new Error('Settings panels must be visible');
        expect(stackedAddresses.y).toBeGreaterThan(stackedConnection.y + stackedConnection.height);
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await dialog.screenshot({ path: testInfo.outputPath('mobile-dark.png') });

        await advanced.locator('summary').click();
        await expect(dialog.getByLabel('BT Scale')).toHaveValue('1');
        if (protocol === 'modbus') {
            await expect(dialog.getByLabel('BT 32-bit Float')).toHaveValue('true');
            await expect(dialog.getByLabel('Float Word Order')).toHaveValue('big');
        }
        await advanced.locator('summary').click();
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(dialog).toBeHidden();
        const params = await page.evaluate(
            () => JSON.parse(localStorage.getItem('fc_machines') ?? '{}').state.machines[0].connectionParams,
        );
        if (protocol === 'modbus') {
            expect(params.modbus_registers.BT).toMatchObject({ div: 1, float: true });
            expect(params.modbus_registers.ET).toBeNull();
            expect(params.word_order).toBe('big');
        } else {
            expect(params.channels).toEqual([expect.objectContaining({ role: 'BT', div: 1 })]);
        }
    });
}
