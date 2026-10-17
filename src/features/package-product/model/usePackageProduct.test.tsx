/** @vitest-environment jsdom */
import { productKeys } from '@entities/product';
import { productStockEventApi } from '@entities/product-stock-event';
import { roastedStockKeys } from '@entities/roasted-stock-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-1', isWorkspaceReady: true }),
}));

vi.mock('@entities/product', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@entities/product')>();
    return { ...orig, productApi: { get: vi.fn() } };
});

vi.mock('@entities/roasted-stock-event', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@entities/roasted-stock-event')>();
    return {
        ...orig,
        ensureRoastedStock: vi.fn(),
    };
});

vi.mock('@entities/product-stock-event', () => ({
    productStockEventApi: { insertPackagingOp: vi.fn().mockResolvedValue(undefined) },
    productStockKeys: { byUser: (id: string) => ['productStock', id] },
}));

const { ensureRoastedStock } = await import('@entities/roasted-stock-event');
const { usePackageProduct } = await import('./usePackageProduct');

const product = {
    id: 'prod-1',
    bean_id: 'bean-1',
    blend_id: null,
    net_weight_grams: 250,
};

const renderPackage = () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    qc.setQueryData(productKeys.all('owner-1'), [product]);
    const api: { current: ReturnType<typeof usePackageProduct> | null } = { current: null };
    const root = createRoot(document.createElement('div'));
    const Probe = () => {
        api.current = usePackageProduct();
        return null;
    };
    act(() => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe))));
    return { api, qc };
};

describe('usePackageProduct (#896)', () => {
    beforeEach(() => {
        vi.mocked(ensureRoastedStock).mockReset();
        vi.mocked(productStockEventApi.insertPackagingOp).mockClear();
    });

    it('no shortage when 1000g on hand and packing 750g (3×250g)', async () => {
        vi.mocked(ensureRoastedStock).mockResolvedValue({ 'bean:bean-1': { grams: 1000, hasEstimate: false } });
        const { api } = renderPackage();
        let result: { shortageGrams: number | null } | undefined;
        await act(async () => {
            result = await api.current?.packageProduct({ productId: 'prod-1', units: 3 });
        });
        expect(result?.shortageGrams).toBeNull();
    });

    it('reports shortage when 750g on hand and packing 1000g (4×250g)', async () => {
        vi.mocked(ensureRoastedStock).mockResolvedValue({ 'bean:bean-1': { grams: 750, hasEstimate: false } });
        const { api } = renderPackage();
        let result: { shortageGrams: number | null } | undefined;
        await act(async () => {
            result = await api.current?.packageProduct({ productId: 'prod-1', units: 4 });
        });
        expect(result?.shortageGrams).toBe(250);
    });

    it('uses pre-deduct snapshot from onMutate when roasted stock was optimistic', async () => {
        const { api, qc } = renderPackage();
        qc.setQueryData(roastedStockKeys.byUser('owner-1'), {
            'bean:bean-1': { grams: 1000, hasEstimate: false },
        });
        vi.mocked(ensureRoastedStock).mockResolvedValue({ 'bean:bean-1': { grams: 200, hasEstimate: false } });
        let result: { shortageGrams: number | null } | undefined;
        await act(async () => {
            result = await api.current?.packageProduct({ productId: 'prod-1', units: 3 });
        });
        expect(result?.shortageGrams).toBeNull();
    });
});
