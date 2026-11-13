import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../../../shared/i18n/locales/en.json';
import ja from '../../../shared/i18n/locales/ja.json';
import ko from '../../../shared/i18n/locales/ko.json';
import zhCN from '../../../shared/i18n/locales/zh-CN.json';
import { buildBlendFormSchema } from './schema';

const resources = {
    en: { translation: en },
    ko: { translation: ko },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
} as const;

const valid = {
    name: 'House Blend',
    description: 'daily',
    components: [
        { bean_id: 'b1', ratio_pct: 60 },
        { bean_id: 'b2', ratio_pct: 40 },
    ],
};

describe('buildBlendFormSchema', () => {
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

    it('accepts name + components whose ratios sum to 100', () => {
        const result = buildBlendFormSchema((key) => key).safeParse(valid);
        expect(result.success).toBe(true);
    });

    it('rejects empty name with the i18n key, not hardcoded Korean', () => {
        const result = buildBlendFormSchema((key) => key).safeParse({ ...valid, name: '' });
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0].path).toEqual(['name']);
        expect(result.error.issues[0].message).toBe('beans.blend.modal.form.nameRequired');
    });

    it('resolves English copy when the active locale is English', async () => {
        await i18n.changeLanguage('en');
        const result = buildBlendFormSchema((key) => i18n.t(key)).safeParse({ ...valid, name: '' });
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0].message).toBe('Enter a blend name');
        expect(result.error.issues[0].message).not.toMatch(/[\uAC00-\uD7A3]/);
    });

    it('resolves Korean copy when the active locale is Korean', async () => {
        await i18n.changeLanguage('ko');
        const result = buildBlendFormSchema((key) => i18n.t(key)).safeParse({ ...valid, name: '' });
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0].message).toBe('블렌드 이름을 입력하세요');
    });

    it('requires at least one component', () => {
        const result = buildBlendFormSchema((key) => key).safeParse({ ...valid, components: [] });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === 'beans.blend.modal.form.componentsMin')).toBe(true);
        }
    });

    it('rejects ratio sum not equal to 100', () => {
        const result = buildBlendFormSchema((key) => key).safeParse({
            ...valid,
            components: [
                { bean_id: 'b1', ratio_pct: 50 },
                { bean_id: 'b2', ratio_pct: 40 },
            ],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === 'beans.blend.modal.form.ratioSum')).toBe(true);
        }
    });

    it('rejects empty bean_id and non-integer / out-of-range ratio', () => {
        const emptyBean = buildBlendFormSchema((key) => key).safeParse({
            ...valid,
            components: [{ bean_id: '', ratio_pct: 100 }],
        });
        expect(emptyBean.success).toBe(false);
        if (!emptyBean.success) {
            expect(emptyBean.error.issues.some((i) => i.message === 'beans.blend.modal.form.beanRequired')).toBe(true);
        }

        const frac = buildBlendFormSchema((key) => key).safeParse({
            ...valid,
            components: [
                { bean_id: 'b1', ratio_pct: 50.5 },
                { bean_id: 'b2', ratio_pct: 49.5 },
            ],
        });
        expect(frac.success).toBe(false);
        if (!frac.success) {
            expect(frac.error.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ code: 'invalid_type', expected: 'integer', received: 'float' }),
                ]),
            );
            expect(frac.error.issues.some((i) => i.message === 'beans.blend.modal.form.ratioSum')).toBe(false);
        }

        const over = buildBlendFormSchema((key) => key).safeParse({
            ...valid,
            components: [{ bean_id: 'b1', ratio_pct: 101 }],
        });
        expect(over.success).toBe(false);
        if (!over.success) {
            expect(over.error.issues).toContainEqual(
                expect.objectContaining({ code: 'too_big', maximum: 100, path: ['components', 0, 'ratio_pct'] }),
            );
        }
    });
});
