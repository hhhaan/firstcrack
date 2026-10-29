import { logger } from '@shared/lib/logger';
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { locale } from '@tauri-apps/plugin-os';
import { ja as dateFnsJa, ko as dateFnsKo, enUS, zhCN } from 'date-fns/locale';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhCNJson from './locales/zh-CN.json';

export const supportedLanguages = ['ko', 'en', 'ja', 'zh-CN'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const LANGUAGE_KEY = 'language';
const LOCAL_STORAGE_KEY = 'fc.language';

const normalizeLanguage = (value: string | null | undefined): SupportedLanguage => {
    const normalized = value?.toLowerCase();
    if (normalized?.startsWith('ko')) return 'ko';
    if (normalized?.startsWith('ja')) return 'ja';
    if (normalized?.startsWith('zh')) return 'zh-CN';
    if (normalized?.startsWith('en')) return 'en';
    return 'en';
};

const getStoredLanguage = async (): Promise<string | undefined> => {
    const fromStore = await settingsGet<string>(LANGUAGE_KEY);
    if (fromStore) return fromStore;
    return window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? undefined;
};

const getSystemLanguage = async (): Promise<string | null> => {
    try {
        return await locale();
    } catch (err) {
        logger.capture(err, { scope: 'i18n.systemLocale' });
        return window.navigator.language;
    }
};

const persistLanguage = async (language: SupportedLanguage) => {
    await settingsSet(LANGUAGE_KEY, language);
    try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, language);
    } catch (err) {
        logger.capture(err, { scope: 'i18n.persistLanguage' });
        /* private mode */
    }
};

export const setLanguage = async (language: SupportedLanguage) => {
    await i18n.changeLanguage(language);
    document.documentElement.lang = language;
    await persistLanguage(language);
};

const localeBundles = {
    ko,
    en,
    ja,
    'zh-CN': zhCNJson,
} as const;

/** Vite keeps i18n alive across edits. Push the new JSON or a new key stays on screen as the key path. */
const syncLocaleBundles = () => {
    if (!i18n.isInitialized) return;
    for (const [lng, bundle] of Object.entries(localeBundles)) {
        i18n.addResourceBundle(lng, 'translation', bundle, true, true);
    }
    i18n.emit('languageChanged', i18n.language);
};

if (import.meta.hot) import.meta.hot.accept();
syncLocaleBundles();

export const initI18n = async ({ persist = true }: { persist?: boolean } = {}) => {
    const savedLanguage = await getStoredLanguage();
    const language = normalizeLanguage(savedLanguage ?? (await getSystemLanguage()));

    await i18n.use(initReactI18next).init({
        lng: language,
        fallbackLng: 'en',
        supportedLngs: supportedLanguages,
        resources: {
            ko: { translation: localeBundles.ko },
            en: { translation: localeBundles.en },
            ja: { translation: localeBundles.ja },
            'zh-CN': { translation: localeBundles['zh-CN'] },
        },
        interpolation: { escapeValue: false },
    });

    document.documentElement.lang = language;

    if (!savedLanguage && persist) {
        await persistLanguage(language);
    }
};

export const getDateFnsLocale = () => {
    switch (i18n.language) {
        case 'ko':
            return dateFnsKo;
        case 'ja':
            return dateFnsJa;
        case 'zh-CN':
            return zhCN;
        default:
            return enUS;
    }
};

export { i18n };
