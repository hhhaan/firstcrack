import { createBeanViaUi, expect, goNav, test } from '../fixtures/app';

const ARTIFACTS = '/opt/cursor/artifacts';

test.use({ channel: 'chrome', viewport: { width: 1440, height: 900 } });

test('in-stock bean shows weight reason, then deducts, and discard confirms', async ({ authedPage: page }) => {
    await createBeanViaUi(page, 'Yirgacheffe', '12');
    await goNav(page, 'roast');
    await page.waitForFunction(() => Boolean(window.__FC_E2E__?.forceChargedSession), null, { timeout: 15_000 });
    await page.evaluate(() => window.__FC_E2E__!.forceChargedSession());
    const tour = page.locator('[data-tour-overlay="spotlight"]');
    if (await tour.count()) {
        await page.keyboard.press('Escape');
        await tour.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    }
    await expect(page.getByTestId('roast-end')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('roast-end').click({ force: true });
    await page.getByTestId('end-roast-confirm').click({ force: true });
    await expect(page.getByTestId('roast-summary-save')).toBeVisible({ timeout: 10_000 });

    const bean = page.getByTestId('roast-summary-bean').locator('input');
    await bean.click();
    await bean.fill('Yirgacheffe');
    await bean.press('Enter');
    await expect(page.getByText('Enter the green charge weight to deduct stock.')).toBeVisible();
    const deduct = page.getByTestId('roast-summary-deduct');
    await expect(deduct).toBeDisabled();
    await expect(page.getByTestId('roast-summary-weight')).toBeEnabled();
    await page.getByRole('dialog').screenshot({ path: `${ARTIFACTS}/summary_modal_no_weight.png` });

    await page.getByTestId('roast-summary-weight').fill('2.5');
    await expect(deduct).toBeEnabled();
    await expect(deduct).toBeChecked();
    await expect(page.getByText('Deduct green stock (2.5kg)')).toBeVisible();
    await page.getByRole('dialog').screenshot({ path: `${ARTIFACTS}/summary_modal_deduct_checked.png` });

    await page.getByTestId('roast-summary-discard').click();
    await expect(page.getByTestId('roast-summary-discard-modal')).toBeVisible();
    await expect(page.getByText('This roast will be deleted without saving. Continue?')).toBeVisible();
    await page
        .getByTestId('roast-summary-discard-modal')
        .screenshot({ path: `${ARTIFACTS}/summary_modal_discard_confirm.png` });

    await page.getByTestId('roast-summary-discard-cancel').click();
    await expect(page.getByTestId('roast-summary-discard-modal')).toBeHidden();
    await expect(page.getByTestId('roast-summary-save')).toBeVisible();

    await page.getByTestId('roast-summary-discard').click();
    await page.getByTestId('roast-summary-discard-confirm').click();
    await expect(page.getByTestId('roast-summary-save')).toBeHidden({ timeout: 10_000 });
});

test('a lot created without reload is selectable in the summary list by its uuid', async ({ authedPage: page }) => {
    await createBeanViaUi(page, 'QA Test Ethiopia', '3');
    const ethiopia = page.locator('[data-testid^="bean-list-item-"]').first();
    await expect(ethiopia).toBeVisible();
    const ethiopiaId = ((await ethiopia.getAttribute('data-testid')) ?? '').replace('bean-list-item-', '');
    expect(ethiopiaId).toMatch(/^[0-9a-f-]{36}$/i);
    await page.evaluate((id) => localStorage.setItem('fc_default_bean_id', id), ethiopiaId);

    await createBeanViaUi(page, 'QA PR576 Lot', '3');
    await page.locator('[data-testid^="bean-list-item-"]').filter({ hasText: 'QA PR576 Lot' }).click();

    await goNav(page, 'roast');
    await page.waitForFunction(() => Boolean(window.__FC_E2E__?.forceChargedSession), null, { timeout: 15_000 });
    await page.evaluate(() => window.__FC_E2E__?.forceChargedSession());
    const tour = page.locator('[data-tour-overlay="spotlight"]');
    if (await tour.count()) {
        await page.keyboard.press('Escape');
        await tour.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    }
    await expect(page.getByTestId('roast-end')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('roast-end').click({ force: true });
    await page.getByTestId('end-roast-confirm').click({ force: true });
    await expect(page.getByTestId('roast-summary-save')).toBeVisible({ timeout: 10_000 });

    const bean = page.getByTestId('roast-summary-bean').locator('input');
    await expect(bean).toHaveValue('QA Test Ethiopia');
    await bean.click();
    const option = page.getByRole('option', { name: 'QA PR576 Lot' });
    await expect(option).toBeVisible();
    const id = await option.getAttribute('data-bean-id');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(id?.startsWith('opt_')).toBe(false);
    await option.click();
    await expect(bean).toHaveValue('QA PR576 Lot');
});
