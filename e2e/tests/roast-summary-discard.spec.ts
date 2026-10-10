import { expect, goNav, test } from '../fixtures/app';

test('roast summary discard closes the modal after confirm', async ({ authedPage: page }) => {
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
    await page.getByTestId('roast-summary-discard').click({ force: true });
    await expect(page.getByTestId('roast-summary-save')).toBeHidden({ timeout: 10_000 });
});
