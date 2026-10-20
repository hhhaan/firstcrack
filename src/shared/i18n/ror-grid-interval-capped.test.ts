import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhCN from './locales/zh-CN.json';

const resources = {
    en: { translation: en },
    ko: { translation: ko },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
} as const;

const KEY = 'settings.tabs.roast.rorGridIntervalCapped';
const VARS = { effective: 5, requested: 1, suffix: '°C', maxTicks: 80 };

describe('settings.tabs.roast.rorGridIntervalCapped', () => {
    beforeAll(async () => {
        if (!i18n.isInitialized) {
            await i18n.init({
                lng: 'en',
                fallbackLng: 'en',
                resources,
                interpolation: { escapeValue: false },
            });
        } else {
            for (const [lng, bundle] of Object.entries(resources)) {
                i18n.addResourceBundle(lng, 'translation', bundle.translation, true, true);
            }
        }
    });

    it('interpolates every var in every locale', () => {
        for (const lng of Object.keys(resources)) {
            const text = i18n.t(KEY, { ...VARS, lng });
            expect(text, lng).not.toMatch(/\{\{/);
            expect(text, lng).toContain('80');
            expect(text, lng).toContain('5°C');
            expect(text, lng).toContain('1°C');
        }
    });

    it('says the range exceeds the tick limit (not "at most")', () => {
        const text = i18n.t(KEY, { ...VARS, lng: 'en' });
        expect(text).toContain('more than the 80-tick limit');
        expect(text).toContain('thinned');
        expect(text).not.toMatch(/at most/i);
        expect(i18n.t(KEY, { ...VARS, lng: 'ko' })).not.toContain('최대');
    });
});
