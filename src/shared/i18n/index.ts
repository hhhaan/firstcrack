import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { locale } from '@tauri-apps/plugin-os';
import { LazyStore } from '@tauri-apps/plugin-store';
import { ko as dateFnsKo, enUS, ja as dateFnsJa, zhCN } from 'date-fns/locale';
import ko from './locales/ko.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCNJson from './locales/zh-CN.json';

export const supportedLanguages = ['ko', 'en', 'ja', 'zh-CN'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const LANGUAGE_KEY = 'language';
const LOCAL_STORAGE_KEY = 'fc.language';

const store = new LazyStore('settings.json');

const normalizeLanguage = (value: string | null | undefined): SupportedLanguage => {
    const normalized = value?.toLowerCase();
    if (normalized?.startsWith('ko')) return 'ko';
    if (normalized?.startsWith('ja')) return 'ja';
    if (normalized?.startsWith('zh')) return 'zh-CN';
    if (normalized?.startsWith('en')) return 'en';
    return 'en';
};

const getStoredLanguage = async (): Promise<string | undefined> => {
    try {
        return await store.get<string>(LANGUAGE_KEY);
    } catch {
        return window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? undefined;
    }
};

const getSystemLanguage = async (): Promise<string | null> => {
    try {
        return await locale();
    } catch {
        return window.navigator.language;
    }
};

const persistLanguage = async (language: SupportedLanguage) => {
    try {
        await store.set(LANGUAGE_KEY, language);
        await store.save();
    } catch {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, language);
    }
};

export const setLanguage = async (language: SupportedLanguage) => {
    await i18n.changeLanguage(language);
    document.documentElement.lang = language;
    await persistLanguage(language);
};

export const initI18n = async () => {
    const savedLanguage = await getStoredLanguage();
    const language = normalizeLanguage(savedLanguage ?? (await getSystemLanguage()));

    await i18n.use(initReactI18next).init({
        lng: language,
        fallbackLng: 'en',
        supportedLngs: supportedLanguages,
        resources: {
            ko: { translation: ko },
            en: { translation: en },
            ja: { translation: ja },
            'zh-CN': { translation: zhCNJson },
        },
        interpolation: { escapeValue: false },
    });

    document.documentElement.lang = language;

    if (!savedLanguage) {
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
