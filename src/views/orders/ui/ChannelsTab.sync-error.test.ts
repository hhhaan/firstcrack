import { formatMutationError, resolveMutationErrorText } from '@shared/lib/mutationErrorMessage';
import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../../../shared/i18n/locales/en.json';
import ja from '../../../shared/i18n/locales/ja.json';
import ko from '../../../shared/i18n/locales/ko.json';
import zhCN from '../../../shared/i18n/locales/zh-CN.json';
import channelsTab from './ChannelsTab.tsx?raw';
import { formatChannelSyncError } from './formatChannelSyncError';

const resources = {
    en: { translation: en },
    ko: { translation: ko },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
} as const;

const DETAIL = 'shop not found';

describe('ChannelsTab sync-failure toast', () => {
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

    it('uses formatChannelSyncError (not { detail } interpolation)', () => {
        expect(channelsTab).toMatch(/formatChannelSyncError\(\s*t,\s*e\s*\)/);
        expect(channelsTab).not.toMatch(/\{\s*detail:\s*text\.detail\s*\}/);
    });

    it('interpolates the real detail string via the shipped helper and i18n.t', async () => {
        for (const lng of Object.keys(resources)) {
            await i18n.changeLanguage(lng);
            const viaHelper = formatChannelSyncError(i18n.t, new Error(DETAIL));
            const viaShared = formatMutationError(i18n.t, resolveMutationErrorText(new Error(DETAIL)));
            expect(viaHelper, lng).toBe(viaShared);
            expect(viaHelper, lng).toContain(DETAIL);
            expect(viaHelper, lng).not.toContain('{{message}}');
        }
    });
});
