import type { InventoryAlert } from '../api/useDashboard';

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

/** 재고 알림 이유 → 전경색 */
export const alertColor: Record<string, string> = {
    out: '#8080F0',
    schedule: '#F59E0B',
    low: '#FFFF54',
};

/** 재고 알림 이유 → 배경색 */
export const alertBg: Record<string, string> = {
    out: 'rgba(128,128,240,0.12)',
    schedule: 'rgba(245,158,11,0.12)',
    low: 'rgba(255,255,84,0.2)',
};

/** 알림 이유 → 번역 키 매핑 */
export const alertReasonLabels: Record<InventoryAlert['reason'], string> = {
    out: 'dashboard.outOfStock',
    schedule: 'dashboard.scheduleStockAlert',
    low: 'dashboard.lowStock',
};
