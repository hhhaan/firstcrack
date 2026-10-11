import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = new Map<string, unknown>();
const mockGet = vi.fn(async (key: string) => storeState.get(key));
const mockSet = vi.fn(async (key: string, value: unknown) => {
    storeState.set(key, value);
});
const mockSave = vi.fn(async () => {});
const mockDelete = vi.fn(async (key: string) => {
    storeState.delete(key);
});

vi.mock('@tauri-apps/plugin-store', () => ({
    LazyStore: class {
        get = mockGet;
        set = mockSet;
        save = mockSave;
        delete = mockDelete;
    },
}));

describe('settings-store singleton', () => {
    beforeEach(() => {
        storeState.clear();
        mockGet.mockClear();
        mockSet.mockClear();
        mockSave.mockClear();
        mockDelete.mockClear();
        vi.resetModules();
    });

    it('settingsGet/settingsSet use one LazyStore and persist', async () => {
        const { settingsGet, settingsSet, SETTINGS_STORE_FILE } = await import('./settings-store');
        expect(SETTINGS_STORE_FILE).toBe('settings.json');

        await settingsSet('inventory.alertHorizonDays', 14);
        expect(mockSet).toHaveBeenCalledWith('inventory.alertHorizonDays', 14);
        expect(mockSave).toHaveBeenCalled();

        storeState.set('inventory.alertHorizonDays', 14);
        const val = await settingsGet<number>('inventory.alertHorizonDays');
        expect(val).toBe(14);
        expect(mockGet).toHaveBeenCalledWith('inventory.alertHorizonDays');
    });

    it('settingsSet debounce defers save until flush', async () => {
        vi.useFakeTimers();
        const { settingsSet, settingsFlush, SETTINGS_SAVE_DEBOUNCE_MS } = await import('./settings-store');
        await settingsSet('roast.settings', { pollIntervalMs: 500 }, { debounce: true });
        expect(mockSet).toHaveBeenCalled();
        expect(mockSave).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(SETTINGS_SAVE_DEBOUNCE_MS + 10);
        expect(mockSave).toHaveBeenCalled();

        mockSave.mockClear();
        await settingsSet('roast.settings', { pollIntervalMs: 1000 }, { debounce: true });
        await settingsFlush();
        expect(mockSave).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('strict writes restore cached settings when disk save fails', async () => {
        const { settingsSet, settingsFlush } = await import('./settings-store');
        storeState.set('roast.settings', { tempMinC: 130 });
        mockSave.mockRejectedValueOnce(new Error('disk full'));
        await expect(settingsSet('roast.settings', { tempMinC: 50 }, { throwOnError: true })).rejects.toThrow(
            'disk full',
        );
        expect(storeState.get('roast.settings')).toEqual({ tempMinC: 130 });
        await settingsSet('other.setting', true);
        await settingsFlush();
        expect(storeState.get('roast.settings')).toEqual({ tempMinC: 130 });
    });

    it('strict writes remove an uncommitted new key and propagate set failures', async () => {
        const { settingsSet } = await import('./settings-store');
        mockSave.mockRejectedValueOnce(new Error('disk full'));
        await expect(settingsSet('new', true, { throwOnError: true })).rejects.toThrow('disk full');
        expect(storeState.has('new')).toBe(false);
        mockSet.mockRejectedValueOnce(new Error('write denied'));
        await expect(settingsSet('new', true, { throwOnError: true })).rejects.toThrow('write denied');
        expect(storeState.has('new')).toBe(false);
    });
});
