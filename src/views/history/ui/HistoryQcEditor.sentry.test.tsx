// @vitest-environment jsdom

import * as Sentry from '@sentry/react';
import { buildSentryOptions, tagsFromQueryMeta } from '@shared/lib/sentry';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChargeWeightEditor } from './HistoryQcEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return { ...actual, captureException: vi.fn(), init: vi.fn() };
});

const { setChargeWeight } = vi.hoisted(() => ({ setChargeWeight: vi.fn() }));
vi.mock('@entities/roast/api', () => ({
    roastSessionApi: {
        setChargeWeight,
        update: vi.fn(),
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, vars?: { min: number; max: number }) => (vars ? `${key}:${vars.min}-${vars.max}` : key),
    }),
}));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner', isWorkspaceReady: true }),
}));

const session = {
    id: 's1',
    weight_grams: 1000,
    output_weight_grams: null,
    roast_level: null,
} as RoastSessionWithRelations;

describe('HistoryQcEditor sentry', () => {
    let host: HTMLDivElement;
    let root: Root;
    let qc: QueryClient;

    beforeEach(() => {
        vi.mocked(Sentry.captureException).mockClear();
        setChargeWeight.mockReset();
        qc = new QueryClient({
            mutationCache: new MutationCache({
                onError: async (error, _vars, _ctx, mutation) => {
                    const { captureActionable } = await import('@shared/lib/sentry');
                    captureActionable(error, { tags: tagsFromQueryMeta(mutation.meta as Record<string, unknown>) });
                },
            }),
        });
    });

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        qc.clear();
    });

    const render = async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root.render(
                createElement(QueryClientProvider, { client: qc }, createElement(ChargeWeightEditor, { session })),
            );
        });
    };

    it('reports exactly one actionable event when charge save fails', async () => {
        setChargeWeight.mockRejectedValue({
            code: 'XX000',
            message: 'save failed at /Users/test/secret on 192.168.10.60:502',
            details: 'path=/Users/test/secret',
            hint: 'nope',
        });
        await render();
        const input = host.querySelector('[data-testid="history-charge-weight"]') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        await act(async () => {
            input.focus();
            setValue?.call(input, '1200');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.blur();
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
        const [captured, hint] = vi.mocked(Sentry.captureException).mock.calls[0];
        expect((captured as { name: string }).name).toBe('SupabaseError');
        expect(hint).toMatchObject({
            tags: { feature: 'history-qc', rpc: 'set_session_charge_weight', 'db.code': 'XX000' },
        });
        const event: Sentry.ErrorEvent = {
            type: undefined,
            exception: { values: [{ type: 'SupabaseError', value: (captured as Error).message }] },
            ...(hint && typeof hint === 'object' ? hint : {}),
        };
        expect(JSON.stringify(event)).toContain('192.168.10.60');
        expect(JSON.stringify(event)).toContain('/Users/test/secret');
        const scrubbed = buildSentryOptions().beforeSend(event, { originalException: captured });
        expect(scrubbed).not.toBeNull();
        const blob = JSON.stringify(scrubbed);
        expect(blob).not.toContain('/Users/test/secret');
        expect(blob).not.toMatch(/\d{1,3}(?:\.\d{1,3}){3}/);
    });
});
