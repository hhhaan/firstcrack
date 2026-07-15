import { LazyStore } from '@tauri-apps/plugin-store';

const store = new LazyStore('settings.json');

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
    } catch {
        return [];
    }
};

const writeLocal = (items: StoredFixedOverhead[]) => {
    try {
        localStorage.setItem(PRICING_FIXED_OVERHEADS_KEY, JSON.stringify(items));
    } catch {
        /* web dev fallback only */
    }
};

export const pricingStore = {
    getFixedOverheads: async (): Promise<StoredFixedOverhead[]> => {
        try {
            const val = await store.get<unknown>(PRICING_FIXED_OVERHEADS_KEY);
            const items = normalize(val);
            if (items.length > 0 || val != null) return items;
        } catch {
            /* Tauri unavailable */
        }
        return readLocal();
    },

    setFixedOverheads: async (items: StoredFixedOverhead[]): Promise<void> => {
        const safe = normalize(items);
        writeLocal(safe);
        try {
            await store.set(PRICING_FIXED_OVERHEADS_KEY, safe);
            await store.save();
        } catch {
            /* Tauri unavailable */
        }
    },
};
