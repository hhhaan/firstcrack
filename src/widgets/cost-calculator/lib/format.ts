export const inputCls =
    'w-full px-3 py-2.5 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all';

export const labelCls = 'text-[11px] font-medium uppercase tracking-[0.5px] text-muted mb-1.5 block';

/** Percentage precision (margin, yield, blend ratio) — all locales. */
export const PCT_DECIMALS = 2;

export const formatKrw = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return '—';
    return `₩${Math.round(value).toLocaleString()}`;
};

export const normalizePct = (value: number, _lang?: string): number => {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** PCT_DECIMALS;
    return Math.round(value * factor) / factor;
};

export const formatPctValue = (value: number, lang?: string): string => {
    if (!Number.isFinite(value) || value <= 0) return '';
    const rounded = normalizePct(value, lang);
    // Drop trailing zeros: 40 → "40", 40.5 → "40.5", 40.25 → "40.25"
    return String(rounded);
};

export const parseNumericInput = (raw: string): number => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return 0;
    return parseInt(digits, 10);
};

export const parseDecimalInput = (raw: string): number => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    if (!cleaned) return 0;
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const parsePctInput = (raw: string, lang?: string): number => normalizePct(parseDecimalInput(raw), lang);
