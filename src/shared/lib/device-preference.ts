import { useSyncExternalStore } from 'react';
import { settingsGet, settingsSet } from './settings-store';

/** Device preferences share settings.json, with a browser fallback and hydration race protection. */
export const createDevicePreference = <T>(key: string, initial: T, normalize: (raw: unknown) => T) => {
    const browserKey = `fc_${key}`;
    let value = initial;
    let touched = false;
    const listeners = new Set<() => void>();
    try {
        const raw = localStorage.getItem(browserKey);
        if (raw) value = normalize(JSON.parse(raw));
    } catch {
        /* No browser storage. */
    }
    const emit = () => {
        for (const listener of listeners) listener();
    };
    void settingsGet<unknown>(key).then((stored) => {
        if (stored === undefined || touched) return;
        value = normalize(stored);
        emit();
    });
    const update = (next: T) => {
        touched = true;
        value = normalize(next);
        try {
            localStorage.setItem(browserKey, JSON.stringify(value));
        } catch {
            /* No browser storage. */
        }
        void settingsSet(key, value, { debounce: true });
        emit();
    };
    const subscribe = (listener: () => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    };
    return { get: () => value, update, useValue: () => useSyncExternalStore(subscribe, () => value) };
};
