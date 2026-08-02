/** Percentage precision (margin, yield, blend ratio) — all locales. */
export const PCT_DECIMALS = 2;

export const formatAmount = (value: number, lang?: string): string => {
    if (!Number.isFinite(value)) return '';
    const locale = lang?.split('-')[0] || undefined;
    return Math.round(value).toLocaleString(locale);
};

/** ko→₩, ja→¥, zh→¥, else→$ (USD fallback). */
export const currencySymbol = (lang?: string): string => {
    const l = lang?.toLowerCase() ?? '';
    if (l.startsWith('ko')) return '₩';
    if (l.startsWith('ja')) return '¥';
    if (l.startsWith('zh')) return '¥';
    return '$';
};

export const formatCurrency = (value: number, lang?: string): string => {
    if (!Number.isFinite(value) || value <= 0) return '—';
    return `${currencySymbol(lang)}${formatAmount(value, lang)}`;
};

/** @deprecated Prefer formatCurrency — kept for existing call sites. */
export const formatKrw = formatCurrency;

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
