import { createBeanViaUi, expect, goNav, test } from '../fixtures/app';

test.describe('2b bean purchase / restock', () => {
    test('create bean lot with stock → visible green stock increase', async ({ authedPage: page, db }) => {
        await createBeanViaUi(page, 'E2E Lot A', '5');

        // Backend received purchase event
        expect(db.beans.some((b) => b.name === 'E2E Lot A')).toBe(true);
        const bean = db.beans.find((b) => b.name === 'E2E Lot A')!;
        expect(db.beanStockGrams(bean.id)).toBe(5000);

        // UI shows stock
        await goNav(page, 'beans');
        const item = page.getByTestId(`bean-list-item-${bean.id}`);
        await expect(item).toBeVisible({ timeout: 15_000 });
        await expect(item).toHaveAttribute('data-stock-kg', '5.00');
        await item.click();
        await expect(page.getByTestId('bean-current-stock')).toContainText('5.00kg');
    });
});
