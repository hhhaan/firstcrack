import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/app';
import { seedAuthSession } from '../fixtures/auth';
import { E2E_PROJECT_REF } from '../fixtures/constants';
import { installMockSupabase } from '../fixtures/mock-supabase';
import { tauriInitScript } from '../fixtures/tauri-stub';

const point = (t: number, bt: number) => ({ t, bt, et: 200, heater: 40, fan: 30, drum: 50 });

const seedLiveBbp = async (
    page: Page,
    input: { generation: string; startMs: number; points: ReturnType<typeof point>[] },
) => {
    await page.evaluate((blob) => {
        localStorage.setItem('fc_bbp_live', JSON.stringify({ v: 2, ...blob }));
        sessionStorage.setItem('fc_bbp_live_gen', blob.generation);
    }, input);
};

test('reload in the same tab continues the current BBP', async ({ authedPage: page }) => {
    const startMs = Date.now() - 30_000;
    await seedLiveBbp(page, {
        generation: 'same-tab',
        startMs,
        points: [point(0, 180), point(30, 190)],
    });
    await page.reload();
    await page.getByTestId('nav-roast').click();
    await expect(page.getByTestId('bbp-timer')).toContainText(/0:3\d/, { timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('fc_bbp_live'))).toContain('same-tab');
});

test('a new tab does not restore the other tab BBP', async ({ authedPage: page, db }) => {
    const startMs = Date.now() - (5 * 60 + 57) * 1000;
    await seedLiveBbp(page, {
        generation: 'tab-a',
        startMs,
        points: [point(0, 180), point(300, 190)],
    });
    await page.reload();
    await page.getByTestId('nav-roast').click();
    await expect(page.getByTestId('bbp-timer')).toContainText(/5:5\d/, { timeout: 20_000 });

    const fresh = await page.context().newPage();
    await fresh.addInitScript(tauriInitScript);
    await seedAuthSession(fresh, E2E_PROJECT_REF);
    await installMockSupabase(fresh, db);
    await fresh.goto('/');
    await expect(fresh.getByTestId('app-sidebar')).toBeVisible({ timeout: 30_000 });
    await fresh.getByTestId('nav-roast').click();
    await expect(fresh.getByTestId('bbp-timer')).toHaveCount(0);
    await expect(fresh.getByText('5:57')).toHaveCount(0);
    expect(await fresh.evaluate(() => localStorage.getItem('fc_bbp_live'))).toContain('tab-a');

    await page.reload();
    await expect(page.getByTestId('bbp-timer')).toContainText(/5:5\d|6:0\d/, { timeout: 20_000 });
    await fresh.close();
});

test('saved BBP seconds match the recorded point span', async ({ authedPage: page }) => {
    const elapsed = 48 * 60;
    const startMs = Date.now() - elapsed * 1000;
    await seedLiveBbp(page, {
        generation: 'span-60',
        startMs,
        points: [point(elapsed - 60, 180), point(elapsed, 190)],
    });
    await page.reload();
    await page.getByTestId('nav-roast').click();
    await expect(page.getByTestId('bbp-timer')).toContainText(/48:/, { timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__FC_E2E__?.readFinalizedBbp));
    await page.evaluate(() => {
        const bridge = window.__FC_E2E__;
        if (!bridge?.forceChargedSession) throw new Error('missing e2e bridge');
        bridge.forceChargedSession();
    });
    await expect
        .poll(() =>
            page.evaluate(() => {
                const bridge = window.__FC_E2E__;
                if (!bridge?.readFinalizedBbp) throw new Error('missing e2e bridge');
                return bridge.readFinalizedBbp();
            }),
        )
        .toEqual({ seconds: 60, span: 60 });
});
