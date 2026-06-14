// Sensor data line colors — use CSS variables for theme support
// Values are resolved from :root (light) / html.dark (dark) at runtime
export const SENSOR_COLORS = {
    bt: 'var(--color-sensor-bt)',
    btBg: 'var(--color-sensor-bt-bg, rgba(34,168,90,0.08))',
    btTarget: 'var(--color-sensor-bt-target, rgba(40,180,130,0.65))',
    btTargetHover: 'var(--color-sensor-bt-target-hover, rgba(40,180,130,0.75))',
    btTargetStrong: 'var(--color-sensor-bt-target-strong, rgba(40,180,130,0.85))',
    // light: #4a85c5 / dark: #BEACF8
    et: 'var(--color-sensor-et)',
    etChart: 'var(--color-sensor-et)',
    etBg: 'var(--color-sensor-et-bg, rgba(190,215,245,0.5))',
    // light: #e8a828 / dark: #FFFF54
    ror: 'var(--color-sensor-ror)',
    rorBg: 'var(--color-sensor-ror-bg, rgba(232,168,40,0.25))',
} as const;

export const PHASE_COLORS = {
    ready: '#28a05a',
    readyBg: 'rgba(220,242,230,0.8)',
    drying: '#c88a28',
    maillard: '#b07828',
    development: '#d47028',
    danger: '#d43a3a',
    dangerBg: 'rgba(245,218,218,0.8)',
} as const;

// Connected status dot (brighter green, distinct from PHASE_COLORS.ready)
export const STATUS_COLORS = {
    active: '#22c55e',
    activeGlow: 'rgba(34,197,94,0.2)',
} as const;