// @vitest-environment jsdom
import { useToastStore } from '@shared/store/toast';
import { MutationCache, MutationObserver, QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { showMutationErrorToast } from './mutationErrorToast';

/** Same wiring as `src/main.tsx`. */
const makeClient = () =>
    new QueryClient({
        mutationCache: new MutationCache({
            onError: (error, _variables, _onMutateResult, mutation) => showMutationErrorToast(error, mutation.meta),
        }),
    });

const runFailingMutation = async (meta?: { silentError: boolean }) => {
    const client = makeClient();
    const observer = new MutationObserver(client, {
        mutationFn: () => Promise.reject(new Error('boom')),
        retry: false,
        meta,
    });
    await observer.mutate().catch(() => {});
};

describe('mutation error feedback', () => {
    beforeEach(() => useToastStore.setState({ toasts: [] }));

    it('raises exactly one toast for a rejected mutation', async () => {
        await runFailingMutation();
        expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('stays silent when the mutation renders its own error', async () => {
        await runFailingMutation({ silentError: true });
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });
});
