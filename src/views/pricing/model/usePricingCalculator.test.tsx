// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePricingCalculator } from './usePricingCalculator';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const data = vi.hoisted(() => ({
    beans: [{ id: 'bean-1', name: 'Coffee', cost_per_kg: 10000 }],
    blends: [
        {
            id: 'blend-1',
            blend_components: [{ id: 'component-1', bean_id: 'bean-1', ratio_pct: 100, beans: { name: 'Coffee' } }],
        },
    ],
}));

vi.mock('@entities/bean/queries', () => ({ useBeans: () => ({ data: data.beans }) }));
vi.mock('@entities/blend/queries', () => ({ useBlends: () => ({ data: data.blends }) }));
vi.mock('@entities/organization', () => ({ useActiveWorkspace: () => ({ workspaceOwnerId: 'owner' }) }));
vi.mock('@shared/lib/pricingStore', () => ({
    pricingStore: { getFixedOverheads: async () => [], setFixedOverheads: vi.fn(async () => {}) },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'ko' } }) }));

describe('pricing calculator drafts', () => {
    let host: HTMLDivElement;
    let root: Root;
    let calculator: ReturnType<typeof usePricingCalculator> | null;

    const current = () => {
        if (!calculator) throw new Error('Calculator is not mounted');
        return calculator;
    };
    const Harness = () => {
        calculator = usePricingCalculator();
        return null;
    };

    beforeEach(async () => {
        data.beans = [{ id: 'bean-1', name: 'Coffee', cost_per_kg: 10000 }];
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(createElement(Harness)));
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        calculator = null;
    });

    it('keeps an explicit zero selling price and returns to margin pricing on input changes', () => {
        act(() => current().handleBeanSelect('bean-1'));
        act(() => current().handleSellingPriceChange(0));
        expect(current().sellingPricePerKg).toBe(0);

        act(() => current().handleYieldChange(80));
        expect(current().sellingPricePerKg).toBeGreaterThan(current().totalCost);

        act(() => current().handleSellingPriceChange(30000));
        expect(current().sellingPricePerKg).toBe(30000);
        act(() => current().handleMarginChange(50));
        expect(current().sellingPricePerKg).toBe(current().totalCost * 2);
    });

    it('derives saved rows while preserving zero and empty cost edits until query data changes', async () => {
        act(() => {
            current().handleModeChange('blend');
            current().handleBlendSelect('blend-1');
        });
        expect(current().greenCostPerKg).toBe(10000);

        act(() => current().handleBlendComponentChange('component-1', { costPerKg: 0 }));
        expect(current().blendComponents[0].costPerKg).toBe(0);
        act(() => current().handleBlendComponentChange('component-1', { costPerKg: null }));
        expect(current().blendComponents[0].costPerKg).toBeNull();
        expect(data.beans[0].cost_per_kg).toBe(10000);

        data.beans = [{ ...data.beans[0], cost_per_kg: 12000 }];
        await act(async () => root.render(createElement(Harness)));
        expect(current().greenCostPerKg).toBe(12000);

        act(() => current().handleBlendSelect(''));
        expect(current().blendComponents).toEqual([]);
        expect(current().greenCostPerKg).toBe(0);
    });

    it('keeps custom rows editable and resets them when switching blend sources', () => {
        act(() => {
            current().handleModeChange('blend');
            current().handleBlendSourceChange('custom');
        });
        const id = current().blendComponents[0].id;
        act(() => current().handleBlendComponentBeanSelect(id, 'bean-1'));
        act(() => current().handleBlendComponentChange(id, { ratioPct: 100, costPerKg: 15000 }));
        expect(current().greenCostPerKg).toBe(15000);

        act(() => current().handleBlendComponentBeanSelect(id, ''));
        expect(current().blendComponents[0]).toMatchObject({ beanId: '', name: 'Coffee', costPerKg: 15000 });
        act(() => current().handleAddBlendRow());
        expect(current().blendComponents).toHaveLength(2);
        act(() => current().handleRemoveBlendRow(id));
        expect(current().blendComponents).toHaveLength(1);

        act(() => current().handleBlendSourceChange('saved'));
        expect(current().blendComponents).toEqual([]);
        act(() => current().handleBlendSelect('blend-1'));
        expect(current().greenCostPerKg).toBe(10000);
        act(() => current().handleBlendSourceChange('custom'));
        expect(current().blendComponents[0]).toMatchObject({ beanId: '', ratioPct: 0, costPerKg: null });
    });
});
