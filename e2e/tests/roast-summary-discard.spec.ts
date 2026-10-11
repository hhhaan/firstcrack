import type { Page } from '@playwright/test';
import { expect, goNav, test } from '../fixtures/app';

const openSummaryAfterDrop = async (page: Page) => {
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
};

test('roast summary discard closes the modal after confirm', async ({ authedPage: page }) => {
    await openSummaryAfterDrop(page);
    await page.getByTestId('roast-summary-discard').click({ force: true });
    await expect(page.getByTestId('roast-summary-save')).toBeHidden({ timeout: 10_000 });
});

test('escape closes the bean dropdown opened via chevron without dismissing the summary', async ({
    authedPage: page,
}) => {
    await openSummaryAfterDrop(page);
    const bean = page.getByTestId('roast-summary-bean');
    await bean.getByRole('button', { name: 'Show bean list' }).click();
    const combobox = bean.getByRole('combobox');
    await expect(combobox).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(combobox).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('roast-summary-save')).toBeVisible();
});

test('escape closes the bean dropdown before dismissing the summary', async ({ authedPage: page }) => {
    await openSummaryAfterDrop(page);
    const bean = page.getByTestId('roast-summary-bean').getByRole('combobox');
    await bean.click();
    await expect(bean).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(bean).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('roast-summary-save')).toBeVisible();
    await page.locator('#roast-summary-modal-title').click({ force: true });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('roast-summary-save')).toBeHidden({ timeout: 10_000 });
});

test('roast summary discard uses in-app confirm when Tauri runtime is absent', async ({ authedPage: page }) => {
    await openSummaryAfterDrop(page);
    await page.evaluate(() => {
        delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });
    await page.getByTestId('roast-summary-discard').click({ force: true });
    await expect(page.getByTestId('roast-summary-discard-modal')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('roast-summary-discard-confirm').click({ force: true });
    await expect(page.getByTestId('roast-summary-save')).toBeHidden({ timeout: 10_000 });
});
