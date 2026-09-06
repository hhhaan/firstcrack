// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSettingsSet = vi.fn(async () => {});
const mockSettingsGet = vi.fn(async () => undefined);

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: mockSettingsGet,
    settingsSet: mockSettingsSet,
}));

const { parseTheme, persistTheme, readLocalTheme, THEME_STORE_KEY } = await import('./theme');

describe('theme store key (#274)', () => {
    beforeEach(() => {
        localStorage.clear();
        mockSettingsSet.mockClear();
        mockSettingsGet.mockClear();
    });

    it('parseTheme accepts only light|dark|system', () => {
        expect(parseTheme('dark')).toBe('dark');
        expect(parseTheme('fc_theme')).toBeNull();
        expect(parseTheme(null)).toBeNull();
    });

    it('readLocalTheme prefers theme.mode over legacy fc_theme', () => {
        localStorage.setItem('fc_theme', 'dark');
        localStorage.setItem(THEME_STORE_KEY, 'light');
        expect(readLocalTheme()).toBe('light');
    });

    it('readLocalTheme falls back to legacy fc_theme', () => {
        localStorage.setItem('fc_theme', 'system');
        expect(readLocalTheme()).toBe('system');
    });

    it('persistTheme writes theme.mode and drops legacy key', () => {
        localStorage.setItem('fc_theme', 'dark');
        persistTheme('light');
        expect(localStorage.getItem(THEME_STORE_KEY)).toBe('light');
        expect(localStorage.getItem('fc_theme')).toBeNull();
        expect(mockSettingsSet).toHaveBeenCalledWith(THEME_STORE_KEY, 'light');
    });
});
