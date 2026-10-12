import { createBeanViaUi, expect, goNav, runRoastSaveWithDeduct, test } from '../fixtures/app';

test('saved roast stays reviewable; text edits preserve stock and return to charge wait', async ({
    authedPage: page,
    db,
}) => {
    await createBeanViaUi(page, 'Review bean', '10');
    await runRoastSaveWithDeduct(page, { beanName: 'Review bean', weightKg: '2' });
    const review = page.getByTestId('completed-roast-review');
    await expect(review).toBeVisible();
    await expect(review.getByTestId('history-detail')).toBeVisible();
    const before = db.stockEvents.length;
    await review.getByTestId('history-edit-text').click();
    await review.getByTestId('history-record-title').fill('Morning batch');
    await review.getByTestId('history-record-notes').fill('Cooling review');
    await review.getByTestId('history-text-save').click();
    await expect(review.getByRole('heading', { name: 'Morning batch', exact: true })).toBeVisible();
    expect(db.stockEvents.length).toBe(before);
    expect(db.sessions[0].bean_id).toBe(db.beans[0].id);
    await review.getByTestId('return-to-charge-wait').click();
    await expect(review).toBeHidden();
    await expect(page.getByTestId('bbp-target-status')).toBeVisible();
    await goNav(page, 'history');
    await page.getByText('Morning batch').first().click();
    await expect(page.getByTestId('history-detail')).toContainText('Cooling review');
});

test('display toggles leave the roast chart settings', async ({ authedPage: page }) => {
    await goNav(page, 'roast');
    await expect(page.getByTestId('app-sidebar').getByText('Roasting', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open roast settings', exact: true }).click();
    await page.getByRole('button', { name: 'BBP', exact: true }).click();
    for (const label of [
        'Show roast reference after BBP',
        'Automatically extend time axis',
        'Automatically extend temperature axis',
    ]) {
        await page.getByLabel(label, { exact: true }).uncheck();
        await expect(page.getByLabel(label, { exact: true })).not.toBeChecked();
    }
});

test('sidebar customization survives reload', async ({ authedPage: page }) => {
    await page.getByRole('button', { name: 'Customize sidebar', exact: true }).click();
    await page.getByLabel('Text size').selectOption('17');
    await page.getByRole('button', { name: 'Move Active Roast down', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    expect(
        await page
            .getByTestId('nav-roast')
            .locator('span')
            .first()
            .evaluate((node) => getComputedStyle(node).fontSize),
    ).toBe('17px');
    const order = await page
        .getByTestId('app-sidebar')
        .locator('[data-testid^="nav-"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
    expect(order.slice(0, 2)).toEqual(['nav-history', 'nav-roast']);
});
