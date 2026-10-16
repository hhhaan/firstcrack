import type { DashboardInventoryAlert } from '@features/dashboard-summary';

/** 로스팅 레벨 → 전경색 */
export const levelColor: Record<string, string> = {
    Light: 'var(--color-palette-yellow)',
    'Medium-Light': 'var(--color-palette-teal)',
    Medium: 'var(--color-palette-blue)',
    'Medium-Dark': 'var(--color-palette-purple)',
    Dark: 'var(--color-palette-violet)',
};

/** 로스팅 레벨 → 배경색 */
export const levelBg: Record<string, string> = {
    Light: 'color-mix(in srgb, var(--color-palette-yellow) 20%, transparent)',
    'Medium-Light': 'color-mix(in srgb, var(--color-palette-teal) 15%, transparent)',
    Medium: 'color-mix(in srgb, var(--color-palette-blue) 12%, transparent)',
    'Medium-Dark': 'color-mix(in srgb, var(--color-palette-purple) 12%, transparent)',
    Dark: 'color-mix(in srgb, var(--color-palette-violet) 12%, transparent)',
};

export { alertBg, alertColor } from '@shared/lib/inventory-alert-styles';

/** 알림 이유 → 번역 키 매핑 */
export const alertReasonLabels: Record<DashboardInventoryAlert['reason'], string> = {
    out: 'dashboard.outOfStock',
    schedule: 'dashboard.scheduleStockAlert',
    low: 'dashboard.lowStock',
};
