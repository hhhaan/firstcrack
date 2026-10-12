import { createBeanViaUi, expect, runRoastSaveWithDeduct, test } from '../fixtures/app';

test('a saved roast stays on its curve until the operator returns to charge wait', async ({ authedPage: page }) => {
    await createBeanViaUi(page, 'Review bean', '10');
    await runRoastSaveWithDeduct(page, { beanName: 'Review bean', weightKg: '2' });
    const review = page.getByTestId('completed-roast-review');
    await expect(review).toBeVisible();
    await expect(page.getByTestId('history-detail')).toHaveCount(0);
    await expect(page.getByTestId('bbp-target-status')).toHaveCount(0);
    await review.getByTestId('return-to-charge-wait').click();
    await expect(review).toBeHidden();
    await expect(page.getByTestId('bbp-target-status')).toBeVisible();
});
