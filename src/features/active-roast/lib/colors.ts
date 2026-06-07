// Sensor data line colors (professional dashboard-grade, light mode)
export const SENSOR_COLORS = {
    // light: #22a85a / dark: #4BE08C
    bt: '#22a85a',
    btBg: 'rgba(34,168,90,0.08)',
    btTarget: 'rgba(40,180,130,0.65)',
    btTargetHover: 'rgba(40,180,130,0.75)',
    btTargetStrong: 'rgba(40,180,130,0.85)',
    // light: #4a85c5 / dark: #BEACF8
    et: '#4a85c5',
    etChart: 'rgba(74,133,197,0.7)',
    etBg: 'rgba(190,215,245,0.5)',
    // light: #e8a828 / dark: #FFFF54
    ror: '#e8a828',
    rorBg: 'rgba(232,168,40,0.25)',
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

// ── Dark mode palette (reference) ─────────────────────────────
// active-roast bg: #181D21
// surface/text: #37383A
