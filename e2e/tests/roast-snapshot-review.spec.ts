import { createBeanViaUi, expect, runRoastSaveWithDeduct, test } from '../fixtures/app';

test('a saved roast stays on its curve until the operator returns to charge wait', async ({ authedPage: page, db }) => {
    await createBeanViaUi(page, 'Review bean', '10');
    await runRoastSaveWithDeduct(page, { beanName: 'Review bean', weightKg: '2' });
    const back = page.getByTestId('return-to-charge-wait');
    await expect(back).toBeVisible();
    await expect(page.getByTestId('roast-charge')).toHaveCount(0);
    await expect(page.getByTestId('history-detail')).toHaveCount(0);
    await expect(page.getByTestId('bbp-target-status')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Green Bean', exact: true })).toBeDisabled();
    const original = { ...db.sessions[0] };
    const title = page.locator('button[title="Roast title"]');
    await title.click();
    const input = page.getByRole('textbox', { name: 'Roast title', exact: true });
    await input.fill('Reviewed roast');
    const saved = page.waitForResponse(
        (response) =>
            response.url().includes('/rest/v1/roast_sessions') &&
            response.request().method() === 'PATCH' &&
            response.ok(),
    );
    await input.press('Enter');
    await saved;
    await expect(page.getByRole('button', { name: 'Reviewed roast', exact: true })).toBeVisible();
    expect(db.sessions[0]).toEqual({ ...original, batch_name: 'Reviewed roast' });
    await back.click();
    await expect(back).toBeHidden();
    await expect(page.getByTestId('bbp-target-status')).toBeVisible();
});
