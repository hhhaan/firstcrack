import { expect, goNavForced, runRoastSaveWithDeduct, test } from '../fixtures/app';
import type { PlanBatchHandoff } from '../../src/shared/types/database.types';

test.describe('2d F3 double-deduct guard', () => {
    test('schedule already deducted → linked roast save does not double-deduct green', async ({
        authedPage: page,
        db,
    }) => {
        const bean = db.seedBean({ name: 'E2E F3 Bean', stockGrams: 20_000 });
        // After seed, schedule complete deducts remaining batch green (5kg * 1)
        const batch = db.seedPlanBatchWithDeduction({
            beanId: bean.id,
            beanName: bean.name,
            batchSizeKg: 5,
            batchCount: 1,
        });
        const afterSchedule = db.beanStockGrams(bean.id);
        expect(afterSchedule).toBe(15_000); // 20kg - 5kg

        // Seed planBatchHandoff (real store bridge) then save via UI with deduct checked
        const handoff: PlanBatchHandoff = {
            planBatchId: batch.id,
            planId: batch.plan_id,
            beanId: bean.id,
            beanName: bean.name,
            blendId: null,
            batchSizeKg: batch.batch_size_kg,
            profileId: null,
            batchCount: batch.batch_count,
            completedSessions: batch.completed_sessions,
        };

        await page.waitForFunction(() => Boolean(window.__FC_E2E__?.startBatch));
        await page.evaluate((h) => {
            window.__FC_E2E__!.startBatch(h);
        }, handoff);

        await runRoastSaveWithDeduct(page, { weightKg: '5' });

        // Client F3 UX and/or server C2 must not apply a second green roast claim
        expect(db.lastSaveOpDeductApplied).toBe(false);
        expect(db.beanStockGrams(bean.id)).toBe(afterSchedule);
        const roastEvents = db.stockEvents.filter((e) => e.event_type === 'roast' && e.bean_id === bean.id);
        expect(roastEvents).toHaveLength(1);
        expect(roastEvents[0].reference_id).toBe(batch.id);

        // Seed was server-side only — reload so React Query re-fetches from mock DB
        await page.reload();
        await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 20_000 });
        await goNavForced(page, 'beans');
        await expect(page.getByTestId(`bean-list-item-${bean.id}`)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId(`bean-list-item-${bean.id}`)).toHaveAttribute('data-stock-kg', '15.00');
    });
});
