// Sensor data line colors — use CSS variables for theme support
// Values are resolved from :root (light) / html.dark (dark) at runtime
export const SENSOR_COLORS = {
    et: 'var(--color-sensor-et)',
} as const;

export const PHASE_COLORS = {
    ready: 'var(--color-phase-ready)',
    readyBg: 'var(--color-phase-ready-bg)',
    drying: 'var(--color-phase-drying)',
    maillard: 'var(--color-phase-maillard)',
    development: 'var(--color-phase-development)',
    danger: 'var(--color-phase-danger)',
    dangerBg: 'var(--color-phase-danger-bg)',
} as const;

// Connected status dot (brighter green, distinct from PHASE_COLORS.ready)
export const STATUS_COLORS = {
    active: '#81FBA5',
    activeGlow: 'rgba(129,251,165,0.2)',
} as const;
