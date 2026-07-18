/** Inventory alert reason → foreground color (banner + dashboard) */
export const alertColor: Record<string, string> = {
    out: '#8080F0',
    schedule: '#F59E0B',
    low: '#FFFF54',
};

/** Inventory alert reason → background color */
export const alertBg: Record<string, string> = {
    out: 'rgba(128,128,240,0.12)',
    schedule: 'rgba(245,158,11,0.12)',
    low: 'rgba(255,255,84,0.2)',
};
