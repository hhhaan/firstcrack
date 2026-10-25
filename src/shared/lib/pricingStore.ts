import { createDevicePreference } from './device-preference';
import { logger } from './logger';

export const PRICING_FIXED_OVERHEADS_KEY = 'pricing.fixedOverheads';

export type StoredFixedOverhead = {
    id: string;
    name: string;
    amountPerKg: number;
};

const isItem = (v: unknown): v is StoredFixedOverhead => {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return (
        typeof o.id === 'string' &&
        typeof o.name === 'string' &&
        typeof o.amountPerKg === 'number' &&
        Number.isFinite(o.amountPerKg)
    );
};

const normalize = (raw: unknown): StoredFixedOverhead[] => {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isItem).map((i) => ({
        id: i.id,
        name: i.name,
        amountPerKg: Math.max(0, i.amountPerKg),
    }));
};

const readLocal = (): StoredFixedOverhead[] => {
    try {
        const raw = localStorage.getItem(PRICING_FIXED_OVERHEADS_KEY);
        if (!raw) return [];
        return normalize(JSON.parse(raw));
    } catch (err) {
        logger.capture(err, { scope: 'pricingStore.readLocal' });
        return [];
    }
};

const preference = createDevicePreference(PRICING_FIXED_OVERHEADS_KEY, readLocal(), normalize);

export const useFixedOverheads = preference.useValue;
export const getFixedOverheads = preference.get;
export const setFixedOverheads = preference.update;
