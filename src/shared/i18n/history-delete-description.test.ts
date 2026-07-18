import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhCN from './locales/zh-CN.json';

const SESSION = 'Ethiopia #12';

const resources = {
    en: { translation: en },
    ko: { translation: ko },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
} as const;

describe('history.delete.description', () => {
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

    it('ships {{name}} in every locale string (not a bare suffix)', () => {
        for (const [lng, bundle] of Object.entries(resources)) {
            const raw = bundle.translation.history.delete.description;
            expect(raw, lng).toContain('{{name}}');
        }
    });

    it('interpolates session name once per locale via the real i18n path', async () => {
        for (const lng of Object.keys(resources)) {
            await i18n.changeLanguage(lng);
            const text = i18n.t('history.delete.description', { name: SESSION });
            expect(text).toContain(SESSION);
            // no leftover placeholder
            expect(text).not.toContain('{{name}}');
            // not the broken double-subject composition (name + full sentence about "this record")
            expect(text).not.toMatch(new RegExp(`${SESSION}\\s+이 기록이`));
            expect(text).not.toMatch(new RegExp(`${SESSION}\\s+この記録`));
            expect(text).not.toMatch(new RegExp(`${SESSION}\\s+此记录`));
            // name appears exactly once
            expect(text.split(SESSION).length - 1).toBe(1);
        }
    });

    it('DeleteSessionModal passes name into t (no outer sessionName + suffix compose)', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const modalPath = join(here, '../../views/history/ui/DeleteSessionModal.tsx');
        const src = readFileSync(modalPath, 'utf8');
        expect(src).toMatch(/t\(\s*['"]history\.delete\.description['"]\s*,\s*\{\s*name:\s*sessionName\s*\}\s*\)/);
        expect(src).not.toMatch(/\{sessionName\}.*t\(\s*['"]history\.delete\.description['"]\s*\)/);
    });
});
