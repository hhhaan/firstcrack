// @vitest-environment jsdom

import * as Sentry from '@sentry/react';
import { createAppQueryClient } from '@shared/lib/createAppQueryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roastSessionApi } from './api';
import { useUpdateRoastRecord } from './queries';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@sentry/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/react')>();
    return { ...actual, captureException: vi.fn(), captureMessage: vi.fn(), init: vi.fn() };
});

vi.mock('@shared/lib/mutationErrorToast', () => ({
    showMutationErrorToast: vi.fn(),
}));

vi.mock('./api', () => ({
    roastSessionApi: { updateRecord: vi.fn() },
}));

const SaveProbe = ({ onReady }: { onReady: (save: () => Promise<unknown>) => void }) => {
    const { mutateAsync } = useUpdateRoastRecord('owner');
    useEffect(() => {
        onReady(() => mutateAsync({} as never));
    }, [mutateAsync, onReady]);
    return null;
};

describe('useUpdateRoastRecord sentry', () => {
    let host: HTMLDivElement;
    let root: Root;
    let save: () => Promise<unknown>;

    beforeEach(() => {
        vi.mocked(Sentry.captureException).mockClear();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    const mount = async () => {
        await act(async () => {
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: createAppQueryClient() },
                    createElement(SaveProbe, {
                        onReady: (next) => {
                            save = next;
                        },
                    }),
                ),
            );
        });
    };

    it('reports one warning for a saved-record SQLSTATE failure, without the user text', async () => {
        vi.mocked(roastSessionApi.updateRecord).mockRejectedValue({
            code: '22P02',
            message: 'invalid input syntax for type json: "user note"',
            details: 'path=/tmp/secret',
            hint: 'check the payload',
        });
        await mount();
        await act(async () => {
            await save().catch(() => undefined);
        });

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [captured, hint] = vi.mocked(Sentry.captureException).mock.calls[0];
        expect(captured).toMatchObject({
            name: 'SupabaseError',
            message: 'SupabaseError 22P02 update_roast_session_record',
            code: '22P02',
        });
        expect(hint).toMatchObject({
            level: 'warning',
            tags: {
                feature: 'history-record',
                rpc: 'update_roast_session_record',
                'db.code': '22P02',
            },
            fingerprint: ['supabase', '22P02', 'update_roast_session_record'],
        });
        const blob = JSON.stringify([captured, hint]);
        expect(blob).not.toContain('user note');
        expect(blob).not.toContain('/tmp/secret');
    });

    it('does not report an expected permission refusal', async () => {
        vi.mocked(roastSessionApi.updateRecord).mockRejectedValue({
            code: '42501',
            message: 'permission denied',
            details: '',
            hint: '',
        });
        await mount();
        await act(async () => {
            await save().catch(() => undefined);
        });
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});
