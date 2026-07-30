/**
 * Evidence tests for inventory UX friction analysis.
 * Each case drives a real shipped entry point (or asserts a real source surface)
 * that underpins a user-journey finding — not a reimplementation of the claim.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRemainingDayBatches, shouldOfferNextRoast } from '@features/active-roast/lib/remaining-day-batches';
import { buildRoastedInbound } from '@features/active-roast/lib/roastedInbound';
import { type SaveRoastDeps, saveRoastCore } from '@features/active-roast/model/useSaveRoast';
import { buildPackagingEvents } from '@features/package-product/lib/buildPackagingEvents';
import type { PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { flowReducer } from '../../views/active-roast/model/useRoastCompletionFlow';
import { resolveContinueCandidates } from '../../views/active-roast/model/useRoastSaveFlow';

const root = join(import.meta.dirname, '../../..');

const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

const handoff: PlanBatchHandoff = {
    planBatchId: 'batch-1',
    planId: 'plan-1',
    beanId: 'bean-1',
    blendId: null,
    beanName: 'Yirg',
    batchCount: 2,
    completedSessions: 0,
    batchSizeKg: 5,
    profileId: null,
};

function makeSaveDeps(overrides: Partial<SaveRoastDeps> = {}): SaveRoastDeps {
    return {
        plan: 'pro',
        userId: 'user-1',
        qc: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
        planBatchHandoff: null,
        countCompletedThisMonth: vi.fn().mockResolvedValue(0),
        countCompletedTotal: vi.fn().mockResolvedValue(0),
        saveOp: vi.fn().mockResolvedValue({ id: 'sess-db-1' }),
        syncRoastCurve: vi.fn().mockResolvedValue(undefined),
        updatePlanBatch: vi.fn().mockResolvedValue(undefined),
        startBatch: vi.fn(),
        recordAdhocSave: vi.fn(),
        getFinalizedBbp: vi.fn().mockReturnValue(null),
        ...overrides,
    };
}

describe('UX friction evidence: post-roast stock + continue', () => {
    it('F1: deductStock false still books roasted inbound (green/roasted side-effects decoupled)', async () => {
        const deps = makeSaveDeps();
        await saveRoastCore(deps, {
            formData: {
                notes: '',
                weightGrams: 5,
                outputWeightKg: 4.2,
                roastLevel: 'Medium',
                beanId: 'bean-1',
                deductStock: false,
            },
            handoffBeanName: null,
            sessionId: 'local-sess',
            userId: 'user-1',
            elapsed: 600,
            roastStartTimeRef: { current: 1750000000000 },
            rawBT: 205,
            selectedBeanId: 'bean-1',
            targetProfileId: null,
            planBatchHandoff: null,
            logEntries: [],
        } as unknown as Parameters<typeof saveRoastCore>[1]);

        const arg = (deps.saveOp as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.deduct).toBe(false);
        expect(arg.deductionGrams).toBe(0);
        // Same save still creates bulk roasted stock — user can grow roasted without green deduct
        expect(arg.inboundGrams).toBe(4200);
        expect(arg.inboundIsEstimate).toBe(false);
    });

    it('F2: unmeasured output → estimated bulk inbound (estimate badge path)', () => {
        const inbound = buildRoastedInbound({
            greenGrams: 5000,
            outputWeightGrams: null,
            roastLevel: 'Medium',
        });
        expect(inbound).toEqual({ grams: 4250, isEstimate: true });
    });

    it('F3: continue offer only when day batches still have remaining sessions', async () => {
        const full: PlanBatchWithProgress = {
            id: 'b1',
            bean_id: 'bean-1',
            blend_id: null,
            bean_name: 'Yirg',
            batch_count: 2,
            completed_sessions: 2,
            batch_size_kg: 5,
            status: 'done',
        } as PlanBatchWithProgress;

        const remaining = getRemainingDayBatches([full], { preferBatchId: 'b1' });
        expect(remaining).toEqual([]);
        expect(shouldOfferNextRoast(remaining)).toBe(false);

        const candidates = await resolveContinueCandidates({
            preferBatchId: 'b1',
            fetchDayBatches: async () => [full],
        });
        expect(candidates).toEqual([]);

        const open = flowReducer(
            {
                endRoastModal: false,
                summaryModal: true,
                summaryData: { totalTime: '10:00', development: '2:00', finalBt: '200', logEntries: [] },
                continueModal: false,
                continueCandidates: [],
            },
            { type: 'SAVE_SUCCESS', payload: { shouldOpenContinue: false } },
        );
        expect(open.continueModal).toBe(false);
        expect(open.summaryModal).toBe(false);
    });

    it('F3b: remaining sessions open continue modal with candidates (organic multi-batch path)', () => {
        const next = flowReducer(
            {
                endRoastModal: false,
                summaryModal: true,
                summaryData: { totalTime: '10:00', development: '2:00', finalBt: '200', logEntries: [] },
                continueModal: false,
                continueCandidates: [],
            },
            {
                type: 'SAVE_SUCCESS',
                payload: { shouldOpenContinue: true, continueCandidates: [handoff] },
            },
        );
        expect(next.continueModal).toBe(true);
        expect(next.continueCandidates[0]?.planBatchId).toBe('batch-1');
        expect(next.summaryModal).toBe(false);
    });
});

describe('UX friction evidence: package / product', () => {
    it('F4: packaging builder never checks on-hand bulk (shortage is post-hoc warning only)', () => {
        // Real shipped builder always emits packaging − even if bulk is 0 — usePackageProduct only warns
        const { productEvents, roastedEvents } = buildPackagingEvents({
            userId: 'u1',
            productId: 'p1',
            units: 100,
            netWeightGrams: 250,
            beanId: 'b1',
            blendId: null,
            opId: 'op-overdraft',
        });
        expect(productEvents[0]?.delta_units).toBe(100);
        expect(roastedEvents[0]?.delta_grams).toBe(-25_000);
        expect(roastedEvents[0]?.event_type).toBe('packaging');
    });

    it('F4b: ProductsTable surfaces shortageWarning after inbound, not a hard block', () => {
        const table = src('src/widgets/products-table/ui/ProductsTable.tsx');
        expect(table).toContain('shortageGrams');
        expect(table).toContain("t('inventory.products.shortageWarning'");
        expect(table).toContain('packageProduct');
        // No confirm-before-overdraft dialog in this surface
        expect(table).not.toMatch(/window\.confirm.*shortage|shortage.*window\.confirm/i);
    });
});

describe('UX friction evidence: UI surfaces (structural)', () => {
    it('F5: roast summary defaults deductStock to false (opt-in green deduct)', () => {
        const modal = src('src/views/active-roast/ui/RoastSummaryModal.tsx');
        expect(modal).toMatch(/deductStock:\s*false/);
        expect(modal).toContain('data-testid="roast-summary-deduct"');
    });

    it('F6: post-roast continue has no inventory handoff CTA (schedule/next only)', () => {
        const cont = src('src/views/active-roast/ui/PlanBatchContinueModal.tsx');
        expect(cont).toContain('onStartNext');
        expect(cont).toContain('onGoToSchedule');
        expect(cont).not.toMatch(/beans|inventory|roasted/i);
        expect(src('src/views/active-roast/ActiveRoast.tsx')).toContain('PlanBatchContinueModal');
    });

    it('F7: roasted empty copy points at roast save but has no navigate CTA in tab', () => {
        const tab = src('src/views/bean/ui/RoastedInventoryTab.tsx');
        expect(tab).toContain("t('inventory.roasted.empty')");
        expect(tab).not.toMatch(/onNavigate|setView\(|navigate\(/);
        const ko = src('src/shared/i18n/locales/ko.json');
        expect(ko).toContain('아직 원두 재고가 없습니다. 로스팅을 저장하면 자동으로 쌓입니다.');
    });

    it('F8: dual deduct entry points (schedule complete vs roast summary) both opt-in false', () => {
        const complete = src('src/widgets/complete-batch-modal/ui/CompleteBatchModal.tsx');
        expect(complete).toMatch(/useState\(false\)/);
        expect(complete).toContain('deductStock');
        const summary = src('src/views/active-roast/ui/RoastSummaryModal.tsx');
        expect(summary).toMatch(/deductStock:\s*false/);
    });

    it('F9: history output weight is grams while save summary is kg (unit flip)', () => {
        const hist = src('src/views/history/ui/OutputWeightEditor.tsx');
        expect(hist).toContain('>g</span>');
        const summary = src('src/views/active-roast/ui/RoastSummaryModal.tsx');
        expect(summary).toContain('outputWeightKg');
        expect(summary).toMatch(/>kg</);
    });

    it('F10: StockDeductModal is dead UI (exported but no consumer outside widget)', () => {
        const widget = src('src/widgets/stock-deduct-modal/ui/StockDeductModal.tsx');
        expect(widget).toContain('activeRoast.stockDeduct');
        // Only the widget itself and its barrel re-export
        const grepped = [
            'src/views/active-roast/ActiveRoast.tsx',
            'src/views/schedule/ScheduleDayView.tsx',
            'src/App.tsx',
        ].map((p) => src(p));
        for (const body of grepped) {
            expect(body).not.toContain('StockDeductModal');
        }
    });

    it('F11: unmapped order lines fulfill without product stock (comment + filter in OrdersTab)', () => {
        const orders = src('src/views/orders/ui/OrdersTab.tsx');
        expect(orders).toContain('unmappedCount');
        expect(orders).toMatch(/No product_id/);
        expect(orders).toContain('useFulfillOrder');
    });

    it('F12: bean list Low/Out uses currentGrams not effectiveGrams (reserved blind spot)', () => {
        const list = src('src/widgets/bean-list/ui/BeanList.tsx');
        expect(list).toContain('currentGrams');
        expect(list).toContain('getStatus(currentGrams');
        expect(list).not.toContain('effectiveGrams');
    });
});
