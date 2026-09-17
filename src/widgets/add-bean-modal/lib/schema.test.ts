import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../../../shared/i18n/locales/en.json';
import ja from '../../../shared/i18n/locales/ja.json';
import ko from '../../../shared/i18n/locales/ko.json';
import zhCN from '../../../shared/i18n/locales/zh-CN.json';
import { buildBeanFormSchema, EMPTY_BEAN_FORM } from './schema';

const resources = {
    en: { translation: en },
    ko: { translation: ko },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
} as const;

const emptyName = { ...EMPTY_BEAN_FORM, name: '' };

describe('buildBeanFormSchema', () => {
    beforeAll(async () => {
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
    });

    it('rejects empty lot name with the i18n key, not hardcoded Korean', () => {
        const result = buildBeanFormSchema((key) => key).safeParse(emptyName);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0].path).toEqual(['name']);
        expect(result.error.issues[0].message).toBe('addBeanModal.form.lotNameRequired');
    });

    it('resolves English copy when the active locale is English', async () => {
        await i18n.changeLanguage('en');
        const result = buildBeanFormSchema((key) => i18n.t(key)).safeParse(emptyName);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0].message).toBe('Enter a lot name');
        expect(result.error.issues[0].message).not.toMatch(/[\uAC00-\uD7A3]/);
    });

    it('resolves Korean copy when the active locale is Korean', async () => {
        await i18n.changeLanguage('ko');
        const result = buildBeanFormSchema((key) => i18n.t(key)).safeParse(emptyName);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0].message).toBe('Lot 이름을 입력하세요');
    });

    it('accepts a named lot', () => {
        const result = buildBeanFormSchema((key) => key).safeParse({
            ...EMPTY_BEAN_FORM,
            name: 'Yirgacheffe',
        });
        expect(result.success).toBe(true);
    });
});
