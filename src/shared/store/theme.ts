import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'fc_theme';

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
    setTheme: (theme: Theme) => void;
    initTheme: () => void;
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

        // system 테마 변경 리스너
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
        // 이전 mediaQuery 리스너 제거
        if (mediaQuery && mediaListener) {
            mediaQuery.removeEventListener('change', mediaListener);
            mediaQuery = null;
            mediaListener = null;
        }

        const resolved = getInitialResolved(theme);
        applyThemeToDOM(resolved);
        localStorage.setItem(STORAGE_KEY, theme);
        set({ theme, resolvedTheme: resolved });

        // system 리스너 재등록
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