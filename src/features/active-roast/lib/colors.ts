// Sensor data line colors
export const SENSOR_COLORS = {
    bt: '#16a34a',
    btBg: 'rgba(22,163,74,0.08)',
    btTarget: 'rgba(16,185,129,0.7)',
    btTargetHover: 'rgba(16,185,129,0.8)',
    btTargetStrong: 'rgba(16,185,129,0.9)',
    et: '#2563eb',
    etChart: 'rgba(37,99,235,0.7)',
    etBg: 'rgba(219,234,254,0.5)',
    ror: '#FFC107',
    rorBg: 'rgba(255,235,59,0.5)',
} as const;

export const PHASE_COLORS = {
    ready: '#16a34a',
    readyBg: 'rgba(220,252,231,0.8)',
    drying: '#d97706',
    maillard: '#b45309',
    development: '#ea580c',
    danger: '#dc2626',
    dangerBg: 'rgba(254,226,226,0.8)',
} as const;

// Connected status dot (brighter green, distinct from PHASE_COLORS.ready)
export const STATUS_COLORS = {
    active: '#22c55e',
    activeGlow: 'rgba(34,197,94,0.2)',
} as const;
