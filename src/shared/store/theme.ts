import { logger } from '@shared/lib/logger';
import { settingsGet, settingsSet } from '@shared/lib/settings-store';
import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORE_KEY = 'theme.mode';
const LEGACY_STORAGE_KEY = 'fc_theme';

export function parseTheme(value: unknown): Theme | null {
    return value === 'light' || value === 'dark' || value === 'system' ? value : null;
}

export function readLocalTheme(): Theme | null {
    try {
        return (
            parseTheme(localStorage.getItem(THEME_STORE_KEY)) ?? parseTheme(localStorage.getItem(LEGACY_STORAGE_KEY))
        );
    } catch (err) {
        logger.capture(err, { scope: 'theme.readLocal' });
        return null;
    }
}

export function persistTheme(theme: Theme): void {
    try {
        localStorage.setItem(THEME_STORE_KEY, theme);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (err) {
        logger.capture(err, { scope: 'theme.persistLocal' });
    }
    void settingsSet(THEME_STORE_KEY, theme);
}

function getInitialResolved(theme: Theme | null): 'light' | 'dark' {
    if (theme === 'dark') return 'dark';
    if (theme === 'light') return 'light';
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeToDOM(resolved: 'light' | 'dark') {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
}

interface ThemeState {
    theme: Theme | null; // null = 아직 선택 안 함 (온보딩 모달 표시)
    resolvedTheme: 'light' | 'dark';
    ready: boolean;
    setTheme: (theme: Theme) => void;
    initTheme: () => void;
}

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

const clearSystemListener = () => {
    if (mediaQuery && mediaListener) {
        mediaQuery.removeEventListener('change', mediaListener);
        mediaQuery = null;
        mediaListener = null;
    }
};

const attachSystemListener = (set: (partial: Partial<ThemeState>) => void) => {
    mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    mediaListener = (e: MediaQueryListEvent) => {
        const next = e.matches ? 'dark' : 'light';
        applyThemeToDOM(next);
        set({ resolvedTheme: next });
    };
    mediaQuery.addEventListener('change', mediaListener);
};

export const useThemeStore = create<ThemeState>((set) => ({
    theme: null,
    resolvedTheme: 'light',
    ready: false,

    initTheme: () => {
        void (async () => {
            try {
                const fromStore = parseTheme(await settingsGet<unknown>(THEME_STORE_KEY));
                const stored = fromStore ?? readLocalTheme();
                const resolved = getInitialResolved(stored);
                applyThemeToDOM(resolved);
                clearSystemListener();
                set({ theme: stored, resolvedTheme: resolved, ready: true });
                if (stored === 'system' || stored === null) attachSystemListener(set);
                if (stored && !fromStore) persistTheme(stored);
            } catch (err) {
                logger.capture(err, { scope: 'theme.init' });
                set({ ready: true });
            }
        })();
    },

    setTheme: (theme: Theme) => {
        clearSystemListener();
        const resolved = getInitialResolved(theme);
        applyThemeToDOM(resolved);
        persistTheme(theme);
        set({ theme, resolvedTheme: resolved, ready: true });
        if (theme === 'system') attachSystemListener(set);
    },
}));
