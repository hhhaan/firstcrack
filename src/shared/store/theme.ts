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
