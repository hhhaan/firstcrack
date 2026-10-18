import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test.describe('2a authenticated shell', () => {
    test('reaches primary workspace view (dashboard)', async ({ authedPage: page }) => {
        await expect(page.getByTestId('app-sidebar')).toBeVisible();
        await expect(page.getByTestId('dashboard-greeting')).toBeVisible();
        await goNav(page, 'beans');
        await expect(page.getByTestId('beans-add-lot')).toBeVisible();
        await goNav(page, 'dashboard');
        await expect(page.getByTestId('dashboard-header')).toBeVisible();
    });

    for (const dark of [false, true]) {
        test(`keeps all ten views inside the content panel (dark=${dark})`, async ({ authedPage: page }, testInfo) => {
            await page.route('**/rest/v1/profiles?*', (route) =>
                route.fulfill({ json: { id: E2E_USER.id, plan: 'pro_plus', business_name: 'E2E Roastery' } }),
            );
            await page.reload();
            await expect(page.getByTestId('app-sidebar')).toBeVisible();
            await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
            const content = page.getByTestId('app-content');
            const sidebar = page.getByTestId('app-sidebar');

            for (const viewport of [
                { width: 1600, height: 1000 },
                { width: 1024, height: 680 },
            ]) {
                await page.setViewportSize(viewport);
                for (const view of [
                    'dashboard',
                    'beans',
                    'orders',
                    'pricing',
                    'schedule',
                    'roast',
                    'history',
                    'profiles',
                    'cupping',
                    'machines',
                ]) {
                    await goNav(page, view);
                    await expect(page.getByTestId(`nav-${view}`)).toHaveAttribute('aria-current', 'page');
                    await expect(content.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(0);
                    if (view === 'roast') await expect(sidebar).toHaveCSS('width', '68px');

                    const panel = await content.boundingBox();
                    const nav = await sidebar.boundingBox();
                    if (!panel || !nav) throw new Error(`Missing shell for ${view}`);
                    expect(panel.x).toBeCloseTo(nav.x + nav.width, 0);
                    expect(panel.y).toBeGreaterThan(0);
                    expect(panel.x + panel.width).toBeLessThan(viewport.width);
                    expect(panel.y + panel.height).toBeLessThan(viewport.height);
                    expect(panel.width).toBeGreaterThan(0);
                    expect(panel.height).toBeGreaterThan(0);

                    if (view === 'roast') {
                        await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
                        const chart = page.getByRole('region', { name: /^Temperature curve chart/ });
                        const plot = await chart.boundingBox();
                        if (!plot) throw new Error('Missing roast chart');
                        expect(plot.width).toBeGreaterThan(200);
                        expect(plot.y + plot.height).toBeLessThanOrEqual(panel.y + panel.height);
                        const beanPicker = await content.locator('select').first().boundingBox();
                        if (!beanPicker) throw new Error('Missing roast header');
                        expect(beanPicker.y).toBeGreaterThanOrEqual(panel.y);
                        await expect(page.getByTestId('roast-side-panel')).toBeVisible();
                    }
                    await page.screenshot({
                        path: testInfo.outputPath(`${view}-${viewport.width}.png`),
                        animations: 'disabled',
                    });
                }
            }
        });
    }
});
