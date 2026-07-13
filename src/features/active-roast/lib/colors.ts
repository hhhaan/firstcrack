// Sensor data line colors — use CSS variables for theme support
// Values are resolved from :root (light) / html.dark (dark) at runtime
export const SENSOR_COLORS = {
    bt: 'var(--color-sensor-bt)',
    btBg: 'var(--color-sensor-bt-bg, rgba(0,157,76,0.12))',
    btTarget: 'var(--color-sensor-bt-target, rgba(0,157,76,0.55))',
    btTargetHover: 'var(--color-sensor-bt-target-hover, rgba(0,157,76,0.75))',
    btTargetStrong: 'var(--color-sensor-bt-target-strong, rgba(0,157,76,0.85))',
    // light: oklch(0.6 0.17 225) / dark: #BEACF8
    et: 'var(--color-sensor-et)',
    etChart: 'var(--color-sensor-et)',
    etBg: 'var(--color-sensor-et-bg, rgba(0,145,203,0.14))',
    // light: oklch(0.78 0.18 88) / dark: #FFFF54
    ror: 'var(--color-sensor-ror)',
    rorBg: 'var(--color-sensor-ror-bg, rgba(231,174,0,0.22))',
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
