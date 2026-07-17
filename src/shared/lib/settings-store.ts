/**
 * Singleton LazyStore for settings.json.
 * Domain modules (inventory, pricing, roast, i18n) are thin key wrappers over this.
 */
import { LazyStore } from '@tauri-apps/plugin-store';

const STORE_FILE = 'settings.json';
const SAVE_DEBOUNCE_MS = 200;

/** Single instance for the whole app (AGENTS: one settings.json). */
const store = new LazyStore(STORE_FILE);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

const flushSave = async (): Promise<void> => {
    try {
        await store.save();
    } catch {
        /* Tauri unavailable / web */
    }
};

const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void flushSave();
    }, SAVE_DEBOUNCE_MS);
};

export const settingsGet = async <T>(key: string): Promise<T | undefined> => {
    try {
        return await store.get<T>(key);
    } catch {
        return undefined;
    }
};

/** Write + save immediately (or debounce if `debounce: true`). */
export const settingsSet = async (key: string, value: unknown, options?: { debounce?: boolean }): Promise<void> => {
    try {
        await store.set(key, value);
        if (options?.debounce) {
            scheduleSave();
        } else {
            await flushSave();
        }
    } catch {
        /* Tauri unavailable / web */
    }
};

/** Force pending debounced save now (tests / app shutdown). */
export const settingsFlush = async (): Promise<void> => {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    await flushSave();
};

/** Test / diagnostic: same file path used by LazyStore. */
export const SETTINGS_STORE_FILE = STORE_FILE;
export const SETTINGS_SAVE_DEBOUNCE_MS = SAVE_DEBOUNCE_MS;
