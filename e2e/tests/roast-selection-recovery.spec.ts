import { createBeanViaUi, expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test('running bean and reference survive a roast-screen remount', async ({ authedPage: page, db }) => {
    await createBeanViaUi(page, 'Recovery Lot', '10');
    const bean = db.beans.find((row) => row.name === 'Recovery Lot');
    if (!bean) throw new Error('Recovery bean was not created');
    await page.route('**/rest/v1/roast_profiles?**', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    id: 'reference-a',
                    user_id: E2E_USER.id,
                    name: 'Recovery Reference',
                    duration_sec: 600,
                    drop_temp_celsius: 200,
                    source_session: null,
                    default_bean: null,
                    default_blend: null,
                },
            ]),
        });
    });
    // Rebuild the query cache so the test reference is available in the real header.
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await goNav(page, 'roast');
    const beans = page.locator('select:visible').filter({ has: page.locator(`option[value="${bean.id}"]`) });
    const profiles = page.locator('select:visible').filter({ has: page.locator('option[value="reference-a"]') });
    await beans.selectOption(bean.id);
    await profiles.selectOption('reference-a');
    await expect(profiles).toHaveValue('reference-a');
    await page.waitForFunction(() => Boolean(window.__FC_E2E__?.forceChargedSession));
    await page.evaluate(() => window.__FC_E2E__?.forceChargedSession());
    await expect(beans).toBeDisabled();
    await page.evaluate(() => window.__FC_E2E__?.remountRoast?.());
    await expect(beans).toHaveValue(bean.id);
    await expect(beans).toBeDisabled();
    await expect(profiles).toHaveValue('reference-a');
    await expect(page.getByTestId('roast-end')).toBeEnabled();
});
