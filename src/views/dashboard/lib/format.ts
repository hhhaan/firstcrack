import { formatDate, gramsToKg, localeForDate } from '@shared/lib/format';

export { formatDate, localeForDate };

/** ISO/Date → 'MMM' (로케일 인지, 월만) */
export const formatMonth = (iso: string | Date | null | undefined): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(localeForDate(), { month: 'short' });
};

/** 그램 → '1.5kg' or '500g' */
export const formatWeight = (grams: number): string => {
    if (grams >= 1000) {
        return `${gramsToKg(grams, 1)}kg`;
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
