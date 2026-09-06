import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import serializeSrc from '../../features/active-roast/lib/serialize-roast-events.ts?raw';
import replaySrc from '../../features/machine-control/ui/ReplayControlPanel.tsx?raw';
import activeRoastSrc from '../../views/active-roast/ActiveRoast.tsx?raw';
import lifecycleSrc from '../../views/active-roast/model/useRoastLifecycle.ts?raw';
import endRoastModalSrc from '../../views/active-roast/ui/EndRoastModal.tsx?raw';
import headerSrc from '../../views/active-roast/ui/RoastHeader.tsx?raw';
import sidePanelSrc from '../../views/active-roast/ui/RoastSidePanel.tsx?raw';
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

describe('active-roast live chrome i18n', () => {
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

    it('wires close / end-roast / machine-required dialogs through t()', () => {
        expect(activeRoastSrc).toMatch(/activeRoast\.dialogs\.roastInProgressMsg/);
        expect(activeRoastSrc).toMatch(/activeRoast\.dialogs\.unsavedRoastMsg/);
        expect(activeRoastSrc).not.toMatch(/로스팅이 진행 중입니다/);
        expect(endRoastModalSrc).toMatch(/activeRoast\.endRoastModal\.title/);
        expect(endRoastModalSrc).not.toMatch(/로스팅을 종료할까요/);
        expect(lifecycleSrc).toMatch(/activeRoast\.dialogs\.machineRequiredMsg/);
        expect(lifecycleSrc).not.toMatch(/머신이 연결되어 있지 않습니다/);
    });

    it('wires side-panel buttons and header placeholders through t()', () => {
        expect(sidePanelSrc).toMatch(/activeRoast\.actions\.roastReady/);
        expect(sidePanelSrc).toMatch(/activeRoast\.actions\.charge/);
        expect(sidePanelSrc).toMatch(/activeRoast\.actions\.endRoast/);
        expect(sidePanelSrc).toMatch(/activeRoast\.actions\.yellow/);
        expect(headerSrc).toMatch(/activeRoast\.header\.noBeanSelected/);
        expect(headerSrc).toMatch(/activeRoast\.header\.noTarget/);
        expect(headerSrc).not.toMatch(/No Bean Selected/);
    });

    it('keeps stored event type strings as English codes', () => {
        expect(sidePanelSrc).toMatch(/event:\s*'Yellow'/);
        expect(sidePanelSrc).toMatch(/event:\s*'FC Start'/);
        expect(sidePanelSrc).toMatch(/event:\s*'Drop'/);
        expect(serializeSrc).toMatch(/type:\s*e\.event/);
    });

    it('translates Replay chrome instead of hardcoded Korean', () => {
        expect(replaySrc).toMatch(/activeRoast\.replay\.enable/);
        expect(replaySrc).not.toMatch(/레퍼런스 화력 재생/);
    });

    it('shortcut locale strings use {{mod}} not a hardcoded ⌘', () => {
        for (const [lng, bundle] of Object.entries(resources)) {
            const yellow = bundle.translation.activeRoast.shortcuts.yellow;
            expect(yellow, lng).toContain('{{mod}}');
            expect(yellow, lng).not.toContain('⌘');
        }
    });

    it('interpolates shortcut glyphs via {{mod}} in every locale', async () => {
        for (const lng of Object.keys(resources)) {
            await i18n.changeLanguage(lng);
            const text = i18n.t('activeRoast.shortcuts.yellow', { mod: 'Ctrl+' });
            expect(text).toBe('Ctrl+1');
            expect(text).not.toContain('{{mod}}');
        }
    });
});
