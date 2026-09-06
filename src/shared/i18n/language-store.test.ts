// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSettingsGet = vi.fn(async (_key: string): Promise<string | undefined> => undefined);
const mockSettingsSet = vi.fn(async () => {});

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: mockSettingsGet,
    settingsSet: mockSettingsSet,
}));

vi.mock('@tauri-apps/plugin-os', () => ({
    locale: async () => 'en-US',
}));

const { initI18n, LANGUAGE_STORE_KEY, setLanguage } = await import('./index');

describe('i18n store key (#274)', () => {
    beforeEach(() => {
        localStorage.clear();
        mockSettingsGet.mockReset();
        mockSettingsSet.mockClear();
        mockSettingsGet.mockResolvedValue('en');
    });

    it('LANGUAGE_STORE_KEY is domain.field', () => {
        expect(LANGUAGE_STORE_KEY).toBe('i18n.language');
    });

    it('setLanguage writes i18n.language and drops fc.language', async () => {
        localStorage.setItem('fc.language', 'en');
        await initI18n();
        mockSettingsSet.mockClear();
        await setLanguage('ko');
        expect(mockSettingsSet).toHaveBeenCalledWith(LANGUAGE_STORE_KEY, 'ko');
        expect(localStorage.getItem(LANGUAGE_STORE_KEY)).toBe('ko');
        expect(localStorage.getItem('fc.language')).toBeNull();
    });
});
