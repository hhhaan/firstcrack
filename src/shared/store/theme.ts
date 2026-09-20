import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

function applyThemeToDOM(resolved: 'light' | 'dark') {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
}

interface ThemeState {
    theme: Theme | null; // null = 아직 선택 안 함 (온보딩 모달 표시)
    resolvedTheme: 'light' | 'dark';
    setTheme: (theme: Theme) => void;
    initTheme: () => void;
}

/** VOC: restore dark/system — uncomment the original store body at the bottom of this file. */
export const useThemeStore = create<ThemeState>((set) => ({
    theme: 'light',
    resolvedTheme: 'light',

    initTheme: () => {
        applyThemeToDOM('light');
        set({ theme: 'light', resolvedTheme: 'light' });
    },

    setTheme: (_theme: Theme) => {
        applyThemeToDOM('light');
        set({ theme: 'light', resolvedTheme: 'light' });
    },
}));

/*
VOC restore (dark / system):

const STORAGE_KEY = 'fc_theme';

function getInitialResolved(theme: Theme | null): 'light' | 'dark' {
    if (theme === 'dark') return 'dark';
    if (theme === 'light') return 'light';
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

export const useThemeStore = create<ThemeState>((set) => ({
    theme: null,
    resolvedTheme: 'light',

    initTheme: () => {
        const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
        const resolved = getInitialResolved(stored);
        applyThemeToDOM(resolved);
        set({ theme: stored, resolvedTheme: resolved });

        if (stored === 'system' || stored === null) {
            mediaQuery = matchMedia('(prefers-color-scheme: dark)');
            mediaListener = (e: MediaQueryListEvent) => {
                const next = e.matches ? 'dark' : 'light';
                applyThemeToDOM(next);
                set({ resolvedTheme: next });
            };
            mediaQuery.addEventListener('change', mediaListener);
        }
    },

    setTheme: (theme: Theme) => {
        if (mediaQuery && mediaListener) {
            mediaQuery.removeEventListener('change', mediaListener);
            mediaQuery = null;
            mediaListener = null;
        }

        const resolved = getInitialResolved(theme);
        applyThemeToDOM(resolved);
        localStorage.setItem(STORAGE_KEY, theme);
        set({ theme, resolvedTheme: resolved });

        if (theme === 'system') {
            mediaQuery = matchMedia('(prefers-color-scheme: dark)');
            mediaListener = (e: MediaQueryListEvent) => {
                const next = e.matches ? 'dark' : 'light';
                applyThemeToDOM(next);
                set({ resolvedTheme: next });
            };
            mediaQuery.addEventListener('change', mediaListener);
        }
    },
}));
*/
