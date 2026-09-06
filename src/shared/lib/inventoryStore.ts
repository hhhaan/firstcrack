import { logger } from './logger';
import { settingsGet, settingsSet } from './settings-store';
import { STOCK_HORIZON_DAYS } from './stock-calc';

const HORIZON_KEY = 'inventory.alertHorizonDays';

const readLocal = (): number | null => {
    try {
        const raw = localStorage.getItem(HORIZON_KEY);
        if (!raw) return null;
        const n = Number.parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch (err) {
        logger.capture(err, { scope: 'inventoryStore.readLocal' });
        return null;
    }
};

const writeLocal = (days: number) => {
    try {
        localStorage.setItem(HORIZON_KEY, String(days));
    } catch (err) {
        logger.capture(err, { scope: 'inventoryStore.writeLocal' });
        /* web dev fallback only */
    }
};

export const inventoryStore = {
    getHorizonDays: async (): Promise<number> => {
        const val = await settingsGet<number>(HORIZON_KEY);
        if (typeof val === 'number' && val > 0) return val;
        return readLocal() ?? STOCK_HORIZON_DAYS;
    },

    setHorizonDays: async (days: number): Promise<void> => {
        const safe = Math.max(1, Math.min(365, Math.round(days)));
        writeLocal(safe);
        await settingsSet(HORIZON_KEY, safe);
    },
};
