// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneralSettingsTab } from './GeneralSettingsTab';

const { setTheme } = vi.hoisted(() => ({ setTheme: vi.fn() }));

vi.mock('@shared/store/theme', () => ({
    useThemeStore: (selector: (state: { theme: string; setTheme: typeof setTheme }) => unknown) =>
        selector({ theme: 'system', setTheme }),
}));

vi.mock('@shared/i18n', () => ({
    setLanguage: vi.fn(),
    supportedLanguages: [],
}));

vi.mock('@shared/lib/inventoryStore', () => ({
    inventoryStore: {
        getHorizonDays: vi.fn().mockResolvedValue(28),
        setHorizonDays: vi.fn(),
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('GeneralSettingsTab theme picker', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        root = createRoot(container);
        setTheme.mockClear();
    });

    afterEach(() => root.unmount());

    it('shows three previews and selects the clicked theme', () => {
        act(() => root.render(createElement(GeneralSettingsTab)));

        const options = [...container.querySelectorAll<HTMLButtonElement>('[data-theme-option]')];
        expect(options).toHaveLength(3);
        expect(options.map((option) => option.dataset.themeOption)).toEqual(['light', 'dark', 'system']);
        expect(options[2]?.getAttribute('aria-pressed')).toBe('true');

        act(() => options[0]?.click());
        expect(setTheme).toHaveBeenCalledWith('light');
    });
});
