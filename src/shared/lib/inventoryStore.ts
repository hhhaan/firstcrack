import { LazyStore } from '@tauri-apps/plugin-store';
import { STOCK_HORIZON_DAYS } from './stock-calc';

const store = new LazyStore('settings.json');

const HORIZON_KEY = 'inventory.alertHorizonDays';

const readLocal = (): number | null => {
    try {
        const raw = localStorage.getItem(HORIZON_KEY);
        if (!raw) return null;
        const n = Number.parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
        return null;
    }
};

const writeLocal = (days: number) => {
    try {
        localStorage.setItem(HORIZON_KEY, String(days));
    } catch {
        /* web dev fallback only */
    }
};

export const inventoryStore = {
    getHorizonDays: async (): Promise<number> => {
        try {
            const val = await store.get<number>(HORIZON_KEY);
            if (typeof val === 'number' && val > 0) return val;
        } catch {
            /* Tauri unavailable */
        }
        return readLocal() ?? STOCK_HORIZON_DAYS;
    },

    setHorizonDays: async (days: number): Promise<void> => {
        const safe = Math.max(1, Math.min(365, Math.round(days)));
        writeLocal(safe);
        try {
            await store.set(HORIZON_KEY, safe);
            await store.save();
        } catch {
            /* Tauri unavailable */
        }
    },
};
