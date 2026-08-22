import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../i18n/locales/en.json';
import ja from '../i18n/locales/ja.json';
import ko from '../i18n/locales/ko.json';
import zhCN from '../i18n/locales/zh-CN.json';
import { formatMutationError, resolveMutationErrorText } from './mutationErrorMessage';

const resources = {
    en: { translation: en },
    ko: { translation: ko },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
} as const;

const DETAIL = 'shop not found';

const ensureI18n = async () => {
    if (!i18n.isInitialized) {
        await i18n.init({
            lng: 'en',
            fallbackLng: 'en',
            resources,
            interpolation: { escapeValue: false },
        });
        return;
    }
    for (const [lng, bundle] of Object.entries(resources)) {
        i18n.addResourceBundle(lng, 'translation', bundle.translation, true, true);
    }
};

describe('resolveMutationErrorText', () => {
    it('surfaces a server message the user can act on', () => {
        const error = Object.assign(new Error('new row violates row-level security policy'), { code: '42501' });
        expect(resolveMutationErrorText(error)).toEqual({
            key: 'errors.mutationFailedDetail',
            detail: 'new row violates row-level security policy',
        });
    });

    it('falls back to the generic copy for opaque transport failures', () => {
        expect(resolveMutationErrorText(new TypeError('Failed to fetch'))).toEqual({ key: 'errors.mutationFailed' });
    });

    it('falls back to the generic copy when there is no message at all', () => {
        expect(resolveMutationErrorText(new Error(''))).toEqual({ key: 'errors.mutationFailed' });
        expect(resolveMutationErrorText({ code: 'PGRST301' })).toEqual({ key: 'errors.mutationFailed' });
    });

    /** Shape verified against @supabase/postgrest-js: a non-throwOnError `.rpc()` error is the
     *  parsed PostgREST body (plain object), RAISE text in `message`, USING DETAIL in `details`. */
    const postgrestError = (message: string, details = '') => ({ code: '23514', details, hint: null, message });

    it('translates the negative-stock guard codes instead of showing the raw code', () => {
        expect(
            resolveMutationErrorText(
                postgrestError('insufficient_product_stock', 'order_id=o1 product_id=p1 balance_units=-3'),
            ),
        ).toEqual({ key: 'errors.insufficientProductStock' });
        expect(
            resolveMutationErrorText(postgrestError('insufficient_roasted_stock', 'target_id=b1 balance_grams=-250')),
        ).toEqual({ key: 'errors.insufficientRoastedStock' });
    });

    it('still maps the guard code when the server string arrives wrapped', () => {
        expect(resolveMutationErrorText(new Error('insufficient_product_stock'))).toEqual({
            key: 'errors.insufficientProductStock',
        });
    });

    it('leaves an unknown server error object on the generic path', () => {
        expect(resolveMutationErrorText(postgrestError('duplicate key value violates unique constraint'))).toEqual({
            key: 'errors.mutationFailed',
        });
    });

    it('truncates long messages', () => {
        const result = resolveMutationErrorText(new Error('x'.repeat(400)));
        expect(result).toEqual({ key: 'errors.mutationFailedDetail', detail: `${'x'.repeat(160)}…` });
    });
});

describe('formatMutationError', () => {
    beforeAll(ensureI18n);

    it('interpolates the server detail through {{message}} in every locale', async () => {
        const text = resolveMutationErrorText(new Error(DETAIL));
        for (const lng of Object.keys(resources)) {
            await i18n.changeLanguage(lng);
            const out = formatMutationError(i18n.t, text);
            expect(out, lng).toContain(DETAIL);
            expect(out, lng).not.toContain('{{message}}');
        }
    });

    it('does not leak {{message}} when the wrong options bag is used (documents the bug)', async () => {
        await i18n.changeLanguage('en');
        const broken = i18n.t('errors.mutationFailedDetail', { detail: DETAIL });
        expect(broken).toContain('{{message}}');
        expect(formatMutationError(i18n.t, resolveMutationErrorText(new Error(DETAIL)))).not.toContain('{{message}}');
    });
});
