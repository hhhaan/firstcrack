// @vitest-environment jsdom
import { useToastStore } from '@shared/store/toast';
import { MutationCache, MutationObserver, QueryClient } from '@tanstack/react-query';
import i18n from 'i18next';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import en from '../i18n/locales/en.json';
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
    beforeAll(async () => {
        if (!i18n.isInitialized) {
            await i18n.init({
                lng: 'en',
                fallbackLng: 'en',
                resources: { en: { translation: en } },
                interpolation: { escapeValue: false },
            });
        } else {
            i18n.addResourceBundle('en', 'translation', en, true, true);
        }
        await i18n.changeLanguage('en');
    });

    beforeEach(() => useToastStore.setState({ toasts: [] }));

    it('raises exactly one toast for a rejected mutation', async () => {
        await runFailingMutation();
        expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('stays silent when the mutation renders its own error', async () => {
        await runFailingMutation({ silentError: true });
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('interpolates the server detail (no leftover {{message}})', () => {
        showMutationErrorToast(new Error('shop not found'), undefined);
        const [toast] = useToastStore.getState().toasts;
        expect(toast?.message).toContain('shop not found');
        expect(toast?.message).not.toContain('{{message}}');
    });
});
