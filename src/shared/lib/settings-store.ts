/**
 * Singleton LazyStore for settings.json.
 * Domain modules (inventory, pricing, roast, i18n) are thin key wrappers over this.
 */
import { LazyStore } from '@tauri-apps/plugin-store';
import { logger } from './logger';

const STORE_FILE = 'settings.json';
const SAVE_DEBOUNCE_MS = 200;

/** Single instance for the whole app (AGENTS: one settings.json). */
const store = new LazyStore(STORE_FILE);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

const flushSave = async (throwOnError = false): Promise<void> => {
    try {
        await store.save();
    } catch (err) {
        /* Tauri unavailable / web */
        logger.capture(err, { scope: 'settings-store.save' });
        if (throwOnError) throw err;
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
    } catch (err) {
        logger.capture(err, { scope: 'settings-store.read', key });
        return undefined;
    }
};

/** Write + save immediately (or debounce if `debounce: true`). */
export const settingsSet = async (
    key: string,
    value: unknown,
    options?: { debounce?: boolean; throwOnError?: boolean },
): Promise<void> => {
    const strict = options?.throwOnError === true;
    let previous: unknown;
    let written = false;
    try {
        if (strict) previous = await store.get(key);
        await store.set(key, value);
        written = true;
        if (options?.debounce && !strict) {
            scheduleSave();
        } else {
            await flushSave(options?.throwOnError);
        }
    } catch (err) {
        if (strict && written) {
            try {
                if (previous === undefined) await store.delete(key);
                else await store.set(key, previous);
            } catch (rollbackError) {
                logger.capture(rollbackError, { scope: 'settings-store.rollback', key });
            }
        }
        logger.capture(err, { scope: 'settings-store.set' });
        if (options?.throwOnError) throw err;
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
