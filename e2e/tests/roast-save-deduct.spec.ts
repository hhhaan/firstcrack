import { createBeanViaUi, expect, goNav, runRoastSaveWithDeduct, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test.describe('2c roast save with stock deduct', () => {
    test('save with deduct → history session + green stock down', async ({ authedPage: page, db }) => {
        await createBeanViaUi(page, 'E2E Roast Bean', '10');
        const bean = db.beans.find((b) => b.name === 'E2E Roast Bean')!;
        const before = db.beanStockGrams(bean.id);
        expect(before).toBe(10_000);

        await runRoastSaveWithDeduct(page, { beanName: 'E2E Roast Bean', weightKg: '2' });

        // Real save_roast_op path applied deduct
        expect(db.lastSaveOpRequestedDeduct).toBe(true);
        expect(db.lastSaveOpDeductApplied).toBe(true);
        expect(db.sessions.length).toBeGreaterThanOrEqual(1);
        expect(db.sessions[0].user_id).toBe(E2E_USER.id);
        expect(db.sessions[0].bean_id).toBe(bean.id);

        const after = db.beanStockGrams(bean.id);
        expect(after).toBe(before - 2000);

        await goNav(page, 'history');
        await expect(page.getByTestId('history-page')).toBeVisible();
        await expect(page.getByText('E2E Roast Bean').first()).toBeVisible({ timeout: 15_000 });

        await goNav(page, 'beans');
        const item = page.getByTestId(`bean-list-item-${bean.id}`);
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute('data-stock-kg', '8.00');
    });
});
