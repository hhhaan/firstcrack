import { test as base, expect, type Page } from '@playwright/test';
import { seedAuthSession } from './auth';
import { E2E_PROJECT_REF } from './constants';
import { MockDb } from './mock-db';
import { installMockSupabase } from './mock-supabase';
import { tauriInitScript } from './tauri-stub';

type Fixtures = {
    db: MockDb;
    authedPage: Page;
};

export const test = base.extend<Fixtures>({
    db: async ({}, use) => {
        const db = new MockDb();
        await use(db);
        db.reset();
    },

    authedPage: async ({ page, db }, use) => {
        await page.addInitScript(tauriInitScript);
        await seedAuthSession(page, E2E_PROJECT_REF);
        await installMockSupabase(page, db);
        await page.goto('/');
        await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 30_000 });
        await use(page);
    },
});

export { expect };

export async function goNav(page: Page, view: string) {
    await page.getByTestId(`nav-${view}`).click();
}

export async function createBeanViaUi(page: Page, name: string, stockKg: string) {
    await goNav(page, 'beans');
    await page.getByTestId('beans-add-lot').click();
    await expect(page.getByTestId('add-bean-modal')).toBeVisible();
    await page.getByTestId('bean-form-name').fill(name);
    await page.getByTestId('bean-form-stock').fill(stockKg);
    await page.getByTestId('bean-form-submit').click();
    await expect(page.getByTestId('add-bean-modal')).toBeHidden({ timeout: 15_000 });
}

export async function runRoastSaveWithDeduct(page: Page, opts: { beanName?: string; weightKg: string }) {
    await goNav(page, 'roast');
    // Hardware-free charge: real roasting store phase machine via VITE_E2E bridge
    await page.waitForFunction(() => Boolean(window.__FC_E2E__?.forceChargedSession), null, { timeout: 15_000 });
    await page.evaluate(() => window.__FC_E2E__!.forceChargedSession());
    // Dismiss tour if still present (persist seed + force)
    const tour = page.locator('[data-tour-overlay="spotlight"]');
    if (await tour.count()) {
        await page.keyboard.press('Escape');
        await tour.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    }
    await expect(page.getByTestId('roast-end')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('roast-end').click({ force: true });
    await page.getByTestId('end-roast-confirm').click({ force: true });
    await expect(page.getByTestId('roast-summary-save')).toBeVisible({ timeout: 10_000 });

    if (opts.beanName) {
        const select = page.getByTestId('roast-summary-bean');
        if (await select.count()) {
            const option = select.locator('option', { hasText: opts.beanName }).first();
            const value = await option.getAttribute('value');
            if (value) await select.selectOption(value);
        }
    }

    await page.getByTestId('roast-summary-weight').fill(opts.weightKg);
    // weight change enables deduct — check after fill
    await page.getByTestId('roast-summary-deduct').check({ force: true });
    await page.getByTestId('roast-summary-save').click();
    // summary closes after save
    await expect(page.getByTestId('roast-summary-save')).toBeHidden({ timeout: 20_000 });
    // Linked schedule batch may open continue/done modal
    const batchDone = page.getByTestId('plan-batch-done');
    if (await batchDone.isVisible().catch(() => false)) {
        await batchDone.click({ force: true });
    }
}

export async function goNavForced(page: Page, view: string) {
    await page.getByTestId(`nav-${view}`).click({ force: true });
}
