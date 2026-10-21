import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { localeForDate } from './format';

describe('localeForDate (dashboard date localization contract)', () => {
    beforeAll(async () => {
        if (!i18n.isInitialized) {
            await i18n.init({
                lng: 'en',
                fallbackLng: 'en',
                resources: {
                    en: { translation: {} },
                    ko: { translation: {} },
                    ja: { translation: {} },
                    'zh-CN': { translation: {} },
                },
                interpolation: { escapeValue: false },
            });
        }
    });

    it('maps ko to en-US (known locale gap — Korean UI still gets English date tokens)', async () => {
        await i18n.changeLanguage('ko');
        expect(localeForDate()).toBe('en-US');
    });

    it('maps zh-CN and ja to matching BCP47 tags', async () => {
        await i18n.changeLanguage('zh-CN');
        expect(localeForDate()).toBe('zh-CN');
        await i18n.changeLanguage('ja');
        expect(localeForDate()).toBe('ja-JP');
    });

    it('defaults unknown languages to en-US', async () => {
        await i18n.changeLanguage('fr');
        expect(localeForDate()).toBe('en-US');
    });
});
