import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

for (const machineControl of [false, true]) {
    for (const dark of [false, true]) {
        test(`independent log: machine=${machineControl}, dark=${dark}`, async ({ authedPage: page }, testInfo) => {
            await page.route('**/rest/v1/profiles?*', (route) =>
                route.fulfill({
                    json: { id: E2E_USER.id, email: E2E_USER.email, plan: 'pro_plus', business_name: 'E2E' },
                }),
            );
            await page.route('**/status', (route) =>
                route.fulfill({
                    json: {
                        connected: true,
                        roaster: 'virtual',
                        error: null,
                        control: {
                            writable: machineControl,
                            limits: machineControl ? { heater: { min: 0, max: 100, unit: '%' } } : {},
                        },
                    },
                }),
            );
            await page.reload();
            await goNav(page, 'roast');
            await page.waitForFunction(() => Boolean(window.__FC_E2E__?.forceChargedSession));
            await page.evaluate(() => window.__FC_E2E__?.forceChargedSession());
            await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);

            const sidePanel = page.getByTestId('roast-side-panel');
            const trigger = sidePanel.getByRole('button', { name: 'Expand roast log' });
            const panel = page.getByTestId('roast-log-panel');
            const chart = page.getByRole('region', { name: /^Temperature curve chart/ });
            const machineToggle = page.getByRole('button', { name: 'Collapse machine control', exact: true });
            if (machineControl) await expect(machineToggle).toBeVisible();
            else await expect(machineToggle).toHaveCount(0);

            const note = sidePanel.locator('textarea');
            await note.fill('retained draft');
            await chart.hover();
            await page.mouse.wheel(0, -100);
            await expect(chart).toHaveClass(/cursor-grab/);
            const canvas = chart.locator('canvas').first();
            const originalCanvas = await canvas.elementHandle();
            for (const viewport of [
                { width: 1024, height: 680 },
                { width: 1260, height: 810 },
                { width: 1600, height: 1000 },
            ]) {
                await page.setViewportSize(viewport);
                const before = await chart.boundingBox();
                if (!before) throw new Error('Chart is missing');
                await sidePanel.evaluate((element) => {
                    element.scrollTop = 0;
                });
                await trigger.focus();
                await page.keyboard.press('Enter');
                await expect(panel).toBeVisible();
                await expect(page.getByRole('separator')).toHaveCount(0);
                await expect(sidePanel.getByText('Roast Log', { exact: true })).toHaveCount(0);
                await expect(panel.getByRole('button', { name: 'Collapse roast log' })).toBeFocused();
                const position = await panel.evaluate((element) => getComputedStyle(element).position);
                const after = await chart.boundingBox();
                if (!after) throw new Error('Chart is missing after opening log');
                expect(position).toBe('static');
                expect(before.width - after.width).toBe(160);
                const logBox = await panel.boundingBox();
                const sideBox = await sidePanel.boundingBox();
                if (!logBox || !sideBox) throw new Error('Side panels are missing');
                expect(logBox.x).toBe(sideBox.x + sideBox.width);
                if (machineControl) {
                    await expect(machineToggle).toBeVisible();
                    await machineToggle.click();
                    await expect(panel).toBeVisible();
                    await page.getByRole('button', { name: 'Expand machine control', exact: true }).click();
                }
                await expect(note).toHaveValue('retained draft');
                await expect(chart).toHaveClass(/cursor-grab/);
                expect(await originalCanvas?.evaluate((element) => element.isConnected)).toBe(true);
                await expect.poll(async () => (await canvas.boundingBox())?.width).toBe(after?.width);
                const plot = await canvas.boundingBox();
                if (!plot) throw new Error('Chart canvas is missing');
                const legend = await chart.getByText(/^Drum(?: \([^)]*\))?$/).boundingBox();
                const frameBottom = await chart.evaluate(
                    (element) => element.parentElement?.parentElement?.getBoundingClientRect().bottom,
                );
                if (!legend || frameBottom == null) throw new Error('Control legend is missing');
                expect(legend.y + legend.height).toBeLessThanOrEqual(frameBottom);
                await page.evaluate(
                    (label) => {
                        const badge = document.createElement('div');
                        badge.id = 'test-chart-dimensions';
                        badge.textContent = label;
                        badge.style.cssText =
                            'position:fixed;bottom:4px;left:80px;z-index:9999;background:#fff;color:#171717;font:12px monospace;padding:4px;border:1px solid #777';
                        document.body.appendChild(badge);
                    },
                    `Chart canvas ${Math.round(plot.width)} × ${Math.round(plot.height)} CSS px · ${viewport.width} × ${viewport.height} · docked log 160px`,
                );
                await testInfo.attach(
                    `${viewport.width}-${dark ? 'dark' : 'light'}-chart-${Math.round(after.width)}x${Math.round(after.height)}`,
                    {
                        body: await page.screenshot(),
                        contentType: 'image/png',
                    },
                );
                await page.evaluate(() => document.getElementById('test-chart-dimensions')?.remove());
                await panel.getByRole('button', { name: 'Collapse roast log' }).focus();
                await page.keyboard.press('Escape');
                await expect(panel).toBeVisible();
                await panel.getByRole('button', { name: 'Collapse roast log' }).click();
                await expect(panel).toHaveCount(0);
                await expect(trigger).toBeFocused();
                await expect.poll(async () => (await chart.boundingBox())?.width).toBe(before?.width);
            }

            await trigger.click();
            await page.setViewportSize({ width: 1024, height: 680 });
            await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).position)).toBe('static');
            await page.setViewportSize({ width: 1600, height: 1000 });
            await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).position)).toBe('static');
            expect(await originalCanvas?.evaluate((element) => element.isConnected)).toBe(true);
            await expect(chart).toHaveClass(/cursor-grab/);
            await note.fill('new live note');
            await note.press('Enter');
            await expect(panel.getByText('new live note', { exact: true })).toBeVisible();
            const bodyBox = await panel.getByText('new live note', { exact: true }).boundingBox();
            const titleBox = await panel.getByRole('heading', { name: 'Roast Log' }).boundingBox();
            expect(bodyBox?.x).toBe(titleBox?.x);
            await panel.getByRole('button', { name: 'Edit Note', exact: true }).click();
            await panel.getByRole('button', { name: 'Delete note' }).click();
            await expect(panel.getByText('new live note', { exact: true })).toHaveCount(0);
            await panel.getByRole('button', { name: 'Collapse roast log' }).click();
            await expect(trigger).toBeFocused();
        });
    }
}
