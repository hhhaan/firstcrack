// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beanStockEventApi } from './api';
import { useBeanStockEvents, useBeanStockSummary } from './queries';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPT = 'opt_11111111-1111-4111-8111-111111111111';
const REAL = '11111111-1111-4111-8111-111111111111';

describe('bean stock queries and optimistic bean ids', () => {
    let qc: QueryClient;
    let root: ReturnType<typeof createRoot>;

    const flush = async () => {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    };

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        root = createRoot(document.createElement('div'));
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.restoreAllMocks();
        qc.clear();
    });

    const mount = async (beanId: string) => {
        function Probe() {
            useBeanStockEvents(beanId);
            useBeanStockSummary(beanId);
            return null;
        }
        await act(async () => {
            root.render(
                <QueryClientProvider client={qc}>
                    <Probe />
                </QueryClientProvider>,
            );
        });
        await flush();
    };

    it('does not fetch while the bean id is still optimistic', async () => {
        const listSpy = vi.spyOn(beanStockEventApi, 'listByBean');
        const summarySpy = vi.spyOn(beanStockEventApi, 'getStockSummary');
        await mount(OPT);
        expect(listSpy).not.toHaveBeenCalled();
        expect(summarySpy).not.toHaveBeenCalled();
    });

    it('fetches after the bean id is a real uuid', async () => {
        vi.spyOn(beanStockEventApi, 'listByBean').mockResolvedValue([]);
        vi.spyOn(beanStockEventApi, 'getStockSummary').mockResolvedValue({
            currentGrams: 0,
            availableGrams: 0,
            reservedGrams: 0,
            effectiveGrams: 0,
        });
        await mount(REAL);
        expect(beanStockEventApi.listByBean).toHaveBeenCalledWith(REAL);
        expect(beanStockEventApi.getStockSummary).toHaveBeenCalledWith(REAL);
    });
});
