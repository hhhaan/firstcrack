import en from '../../src/shared/i18n/locales/en.json' with { type: 'json' };
import { expect, test } from '../fixtures/app';

test('dashboard metrics use saved roasts and remain readable at desktop sizes', async ({
    authedPage: page,
    db,
}, testInfo) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 15);
    for (const [date, weight, duration] of [
        [today, 6000, 600],
        [today, 4000, 480],
        [previousMonth, 2000, 360],
    ] as const) {
        db.seedCompletedSession({
            roasted_at: date.toISOString(),
            weight_grams: weight,
            duration_seconds: duration + 30,
            events: [{ type: 'Drop', time_sec: duration }],
            beans: {
                name: 'Dashboard sample',
                origin: 'Ethiopia',
                region: null,
                variety: null,
                process: null,
                farm: null,
            },
        });
    }
    let price = 350;
    await page.route('**/functions/v1/coffee-futures', (route) =>
        route.fulfill({
            json: { price: price++, previousClose: 340 },
        }),
    );
    await page.reload();
    const metrics = page.getByTestId('dashboard-metrics');
    await expect(metrics).toHaveAttribute('aria-busy', 'false');
    const weight = metrics
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: en.dashboard.kpi.beansRoasted, exact: true }) });
    await expect(weight.getByText('10.0', { exact: true })).toBeVisible();
    await expect(metrics.getByRole('heading', { name: en.dashboard.kpi.avgRoastTime, exact: true })).toHaveCount(0);
    await expect(metrics.getByRole('img')).toHaveCount(3);
    await expect(metrics.getByText('350.00', { exact: true })).toBeVisible();
    await metrics.getByRole('button', { name: en.dashboard.refresh }).click();
    await expect(metrics.getByText('351.00', { exact: true })).toBeVisible();

    for (const width of [1024, 1600]) {
        await page.setViewportSize({ width, height: 1100 });
        const content = page.getByTestId('app-content');
        await expect.poll(() => content.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        await expect(metrics.getByRole('heading')).toHaveCount(4);
        await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`), animations: 'disabled' });
    }
    await page.getByRole('button', { name: en.dashboard.viewAll, exact: true }).click();
    await expect(page.getByTestId('nav-history')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('nav-dashboard').click();
    await page.getByRole('button', { name: en.dashboard.viewActiveRoast }).click();
    await expect(page.getByTestId('nav-roast')).toHaveAttribute('aria-current', 'page');
});
