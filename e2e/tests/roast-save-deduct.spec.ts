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

    test('edits the numbered title and changes beans independently', async ({ authedPage: page, db }, testInfo) => {
        const bean = db.seedBean({
            name: 'Santander Cooperative',
            origin: 'Colombia',
            region: 'Santander',
            stockGrams: 10_000,
        });
        const otherBean = db.seedBean({ name: '마라닉', origin: '', stockGrams: 10_000 });
        await page.evaluate((ownerId) => {
            localStorage.setItem(
                'roast.batchNumbers',
                JSON.stringify({ counters: { [JSON.stringify([ownerId, null])]: 2 }, sessions: {} }),
            );
        }, E2E_USER.id);
        await page.reload();
        await goNav(page, 'roast');
        await page
            .locator('select')
            .filter({ has: page.locator(`option[value="${bean.id}"]`) })
            .selectOption(bean.id);
        await page.getByTestId('roast-ready').click();
        await page.getByTestId('roast-charge').click();
        const title = page.getByRole('textbox', { name: 'Roast title', exact: true });
        const automaticTitle = page.getByRole('button', { name: 'Colombia Santander #3', exact: true });
        await expect(automaticTitle).toBeVisible();
        await expect(title).toHaveCount(0);
        await automaticTitle.click();
        await expect(title).toBeFocused();
        await expect(title).toHaveValue('Colombia Santander #3');
        await title.fill('Morning production');
        await title.press('Enter');
        const editedTitle = page.getByRole('button', { name: 'Morning production', exact: true });
        await expect(editedTitle).toBeVisible();
        await editedTitle.click();
        await title.fill('Discard this draft');
        await title.press('Escape');
        await expect(editedTitle).toBeVisible();
        await editedTitle.click();
        await title.fill('');
        await title.press('Enter');
        await expect(automaticTitle).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('bean-batch-title.png') });
        const source = page.getByRole('combobox', { name: 'Green Bean', exact: true });
        await expect(source).toBeEnabled();
        await source.click();
        await source.press('Escape');
        await source.selectOption(otherBean.id);
        const otherAutomaticTitle = page.getByRole('button', { name: '마라닉 #3', exact: true });
        await expect(otherAutomaticTitle).toBeVisible();
        await otherAutomaticTitle.click();
        await title.fill('Morning production');
        await title.press('Tab');
        await expect(editedTitle).toBeVisible();
        await source.selectOption(bean.id);
        await expect(editedTitle).toBeVisible();
        await source.selectOption(otherBean.id);
        await expect(editedTitle).toBeVisible();
        await page.evaluate(() => window.__FC_E2E__?.remountRoast?.());
        await expect(editedTitle).toBeVisible();
        await expect(source).toHaveValue(otherBean.id);
        await page.screenshot({ path: testInfo.outputPath('independent-title-and-source.png') });

        await page.getByTestId('roast-end').click();
        await page.getByTestId('end-roast-confirm').click();
        await page.getByTestId('roast-summary-weight').fill('2');
        const saveRequest = page.waitForRequest('**/rest/v1/rpc/save_roast_op');
        await page.getByTestId('roast-summary-save').click();
        expect((await saveRequest).postDataJSON().p_session).toMatchObject({
            bean_id: otherBean.id,
            batch_name: 'Morning production',
        });
        await expect(page.getByTestId('roast-summary-save')).toBeHidden();
    });

    test('switches live profile numbers while keeping the physical roast total', async ({
        authedPage: page,
        db,
    }, testInfo) => {
        const bean = db.seedBean({ name: 'Lot', origin: '', stockGrams: 10_000 });
        await page.route('**/rest/v1/roast_profiles?**', (route) =>
            route.fulfill({
                json: ['a', 'b'].map((id) => ({
                    id,
                    user_id: E2E_USER.id,
                    name: `Profile ${id.toUpperCase()}`,
                    duration_sec: 600,
                    drop_temp_celsius: 200,
                    source_session: null,
                    default_bean: null,
                    default_blend: null,
                })),
            }),
        );
        await page.evaluate((ownerId) => {
            localStorage.setItem(
                'roast.batchNumbers',
                JSON.stringify({
                    counters: {
                        [JSON.stringify([ownerId, 'a'])]: 4,
                        [JSON.stringify([ownerId, 'b'])]: 8,
                        [JSON.stringify([ownerId, null, 'total'])]: 12,
                    },
                    sessions: {},
                }),
            );
        }, E2E_USER.id);
        await page.reload();
        await goNav(page, 'roast');
        await page.getByRole('combobox', { name: 'Green Bean', exact: true }).selectOption(bean.id);
        const selectProfile = async (name: string) => {
            await page.getByRole('button', { name: 'Target:', exact: true }).click();
            await page.getByRole('button', { name, exact: true }).click();
        };
        const reservation = () =>
            page.evaluate(() => {
                const ledger = JSON.parse(localStorage.getItem('roast.batchNumbers') ?? '{}');
                return Object.values(ledger.sessions)[0];
            });
        await selectProfile('Profile A');
        await page.getByTestId('roast-ready').click();
        await page.getByTestId('roast-charge').click();
        await expect(page.getByRole('button', { name: 'Lot #5', exact: true })).toBeVisible();
        await selectProfile('Profile B');
        await expect(page.getByRole('button', { name: 'Lot #9', exact: true })).toBeVisible();
        await expect.poll(reservation).toMatchObject({
            scope: JSON.stringify([E2E_USER.id, 'b']),
            number: 9,
            totalNumber: 13,
        });
        await selectProfile('Profile A');
        await expect(page.getByRole('button', { name: 'Lot #5', exact: true })).toBeVisible();
        await selectProfile('Profile B');
        await expect(page.getByRole('button', { name: 'Lot #9', exact: true })).toBeVisible();
        await page.evaluate(() => window.__FC_E2E__?.remountRoast?.());
        await expect(page.getByRole('button', { name: 'Lot #9', exact: true })).toBeVisible();
        await expect.poll(reservation).toMatchObject({ number: 9, totalNumber: 13 });
        await page.screenshot({ path: testInfo.outputPath('profile-batch-number.png') });
        await page.getByTestId('roast-end').click();
        await page.getByTestId('end-roast-confirm').click();
        await page.getByTestId('roast-summary-weight').fill('2');
        const saveRequest = page.waitForRequest('**/rest/v1/rpc/save_roast_op');
        await page.getByTestId('roast-summary-save').click();
        expect((await saveRequest).postDataJSON().p_session).toMatchObject({ profile_id: 'b', batch_name: 'Lot #9' });
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
