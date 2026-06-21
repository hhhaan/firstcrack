import { i18n } from '@shared/i18n';

/** ISO/Date → 'MMM dd' (로케일 인지) */
export const formatDate = (iso: string | Date | null | undefined): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(localeForDate(), { month: 'short', day: 'numeric' });
};

/** ISO/Date → 'MMM' (로케일 인지, 월만) */
export const formatMonth = (iso: string | Date | null | undefined): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(localeForDate(), { month: 'short' });
};

/** 그램 → '1.5kg' or '500g' */
export const formatWeight = (grams: number): string => {
    if (grams >= 1000) {
        return `${(grams / 1000).toFixed(1)}kg`;
    }
    return `${Math.round(grams)}g`;
};

/** 시각 기반 인사말 키 */
export const getGreeting = (): 'morning' | 'afternoon' | 'evening' => {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 18) return 'afternoon';
    return 'evening';
};

/** i18n.language → Date 로케일 */
export const localeForDate = (): string => {
    switch (i18n.language) {
        case 'ko':
            return 'en-US';
        case 'zh-CN':
            return 'zh-CN';
        case 'ja':
            return 'ja-JP';
        default:
            return 'en-US';
    }
};
