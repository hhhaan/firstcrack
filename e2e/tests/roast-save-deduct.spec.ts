import { createBeanViaUi, expect, goNav, runRoastSaveWithDeduct, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test.describe('2c roast save with stock deduct', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('http://127.0.0.1:9999/**', (route) =>
            route.fulfill({
                json: route.request().url().endsWith('/temperatures')
                    ? { bt: 185, et: 210, ror: 8, timestamp: Date.now() / 1000 }
                    : { ok: true, connected: true, roaster: 'virtual', capabilities: ['heater', 'fan', 'drum'] },
            }),
        );
    });

    test('saves the numbered bean heading as the roast title', async ({ authedPage: page, db }, testInfo) => {
        const bean = db.seedBean({
            name: 'Santander Cooperative',
            origin: 'Colombia',
            region: 'Santander',
            stockGrams: 10_000,
        });
        await page.evaluate((ownerId) => {
            localStorage.setItem(
                'roast.batchNumbers',
                JSON.stringify({ counters: { [JSON.stringify([ownerId, null])]: 2 }, sessions: {} }),
            );
        }, E2E_USER.id);
        await page.reload();
        await goNav(page, 'roast');
        const picker = page.locator('select').filter({ has: page.locator(`option[value="${bean.id}"]`) });
        await picker.selectOption(bean.id);
        await page.getByTestId('roast-ready').click();
        await page.getByTestId('roast-charge').click();
        await expect(page.getByText('Colombia Santander #3', { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('numbered-roast-title.png') });

        await page.getByTestId('roast-end').click();
        await page.getByTestId('end-roast-confirm').click();
        await page.getByTestId('roast-summary-weight').fill('2');
        const saveRequest = page.waitForRequest('**/rest/v1/rpc/save_roast_op');
        await page.getByTestId('roast-summary-save').click();
        expect((await saveRequest).postDataJSON().p_session.batch_name).toBe('Colombia Santander #3');
        await expect(page.getByTestId('roast-summary-save')).toBeHidden();
    });

    test('save with deduct → history session + green stock down', async ({ authedPage: page, db }) => {
        await createBeanViaUi(page, 'E2E Roast Bean', '10');
        const bean = db.beans.find((b) => b.name === 'E2E Roast Bean')!;
        const before = db.beanStockGrams(bean.id);
        expect(before).toBe(10_000);

        await runRoastSaveWithDeduct(page, { beanName: 'E2E Roast Bean', weightKg: '2' });

        // Real save_roast_op path applied deduct
        expect(db.lastSaveOpRequestedDeduct).toBe(true);
        expect(db.lastSaveOpDeductApplied).toBe(true);
        expect(db.sessions.length).toBeGreaterThanOrEqual(1);
        expect(db.sessions[0].user_id).toBe(E2E_USER.id);
        expect(db.sessions[0].bean_id).toBe(bean.id);

        const after = db.beanStockGrams(bean.id);
        expect(after).toBe(before - 2000);

        await goNav(page, 'history');
        await expect(page.getByTestId('history-page')).toBeVisible();
        await expect(page.getByText('E2E Roast Bean').first()).toBeVisible({ timeout: 15_000 });

        await goNav(page, 'beans');
        const item = page.getByTestId(`bean-list-item-${bean.id}`);
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute('data-stock-kg', '8.00');
    });
});
