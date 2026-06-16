// ── Grid margins ─────────────────────────────────────────────────────────────
export const CHART_GRID_LEFT = 55;
export const CHART_GRID_TOP = 10;
export const CHART_GRID_RIGHT = 12;
export const CHART_GRID_RIGHT_WITH_ROR = 50;
export const Y_AXIS_NAME_GAP = 16;

// ── Phase bar dimensions & text style ────────────────────────────────────────
export const PHASE_BAR_HEIGHT = 26;
export const PHASE_BAR_BOTTOM = 40;
export const PHASE_BAR_WIDE_THRESHOLD = 70;
export const PHASE_BAR_NARROW_THRESHOLD = 30;
export const PHASE_BAR_TEXT_INSET = 6;
export const PHASE_BAR_STROKE = 'rgba(0,0,0,0.08)';
export const PHASE_BAR_STROKE_WIDTH = 0.5;
export const PHASE_BAR_NAME_COLOR = '#444';
export const PHASE_BAR_DURATION_COLOR = '#555';
export const PHASE_BAR_FONT_SIZE = 10;
export const PHASE_BAR_FONT_SIZE_NARROW = 9;
export const PHASE_BAR_FONT_FAMILY = 'monospace';
export const PHASE_BAR_FONT_WEIGHT = 600;

// ── Axis label typography ────────────────────────────────────────────────────
export const AXIS_LABEL_FONT = { fontSize: 11, fontFamily: 'monospace' as const } as const;
export const AXIS_LABEL_FONT_SM = { fontSize: 10, fontFamily: 'monospace' as const } as const;

// ── Temperature axis range ───────────────────────────────────────────────────
export const TEMP_Y_MIN_C = 50;
export const TEMP_Y_MAX_C = 250;
export const TEMP_Y_MIN_F = 122;
export const TEMP_Y_MAX_F = 482;
export const TEMP_Y_INTERVAL = 20;

// ── Multi-grid layout proportions (controlData mode) ────────────────────────
export const TEMP_GRID_HEIGHT_WITH_PHASE = '48%';
export const CONTROL_GRID_TOP_WITH_PHASE = '52%';
export const PHASE_GRID_TOP = '58%';
export const TEMP_GRID_HEIGHT = '65%';
export const CONTROL_GRID_TOP = '68%';
export const CONTROL_GRID_BOTTOM_GAP = 6;
export const CONTROL_GRID_BOTTOM = 40;

// ── Single-grid layout (no controlData) ─────────────────────────────────────
export const SINGLE_GRID_BOTTOM = 65;

// ── Resolved colors for ECharts (reads CSS variables at runtime) ────────────
// ECharts uses canvas rendering and doesn't support CSS var() natively,
// so we resolve them at runtime from the document's computed styles.
export const getResolvedChartColors = () => {
    const root = getComputedStyle(document.documentElement);
    const gv = (key: string, fallback: string) => {
        const val = root.getPropertyValue(key).trim();
        return val || fallback;
    };

    return {
        btTarget: gv('--color-sensor-bt-target', 'rgba(40,180,130,0.65)'),
        btTargetTooltip: gv('--color-sensor-bt-target-hover', 'rgba(40,180,130,0.75)'),
        btActual: gv('--color-sensor-bt', '#22a85a'),
        etActual: gv('--color-sensor-et', '#4a85c5'),
        rorActual: gv('--color-sensor-ror', '#e8a828'),
        tp: '#81FBA5',
        phaseLines: gv('--color-chart-phaseline', 'rgba(0,0,0,0.07)'),
        currentTimeLine: gv('--color-chart-current-line', 'rgba(0,0,0,0.3)'),
        nowLabel: '#81FBA5',
        gridLine: gv('--color-chart-grid-stroke', 'rgba(0,0,0,0.05)'),
        gridLineMinor: gv('--color-chart-grid', 'rgba(0,0,0,0.05)'),
        axisLabel: gv('--color-chart-axis-label', '#666'),
        axisPointerLine: '#64748b',
        tooltipTimeColor: '#9ca3af',
        markerLabelColor: '#fff',
    };
};

// ── Static base colors (for non-ECharts use) ───────────────────────────────
export const CHART_COLORS = {
    btTarget: 'var(--color-sensor-bt-target)',
    btTargetTooltip: 'var(--color-sensor-bt-target-hover)',
    btActual: 'var(--color-sensor-bt)',
    etActual: 'var(--color-sensor-et)',
    rorActual: 'var(--color-sensor-ror)',
    tp: '#81FBA5',
    phaseLines: 'var(--color-chart-phaseline)',
    currentTimeLine: 'var(--color-chart-current-line)',
    nowLabel: '#81FBA5',
    gridLine: 'var(--color-chart-grid-stroke)',
    gridLineMinor: 'var(--color-chart-grid)',
    axisPointerLine: '#64748b',
    tooltipTimeColor: '#9ca3af',
    markerLabelColor: '#fff',
} as const;

export const CONTROL_COLORS = {
    drum: '#72EBBC',
    heat: '#FFFF54',
    heatArea: 'rgba(255,255,84,0.15)',
    fan: '#44BFFC',
    fanArea: 'rgba(68,191,252,0.15)',
} as const;

export const EVENT_MARKER_COLORS: Record<string, string> = {
    Yellow: '#FFFF54',
    'FC Start': '#44BFFC',
    'FC End': '#756AFC',
    End: '#8080F0',
    Note: '#72EBBC',
    TP: '#81FBA5',
    Drop: '#A6B0FF',
};

export const PHASE_SECS = [180, 300, 630] as const;
export const ROR_Y_MIN = -5;
export const ROR_Y_MAX = 20;
export const MARKER_LABEL_FONT_CSS_PX = 14;
export const MARKER_LABEL_Y_OFFSET_CSS_PX = 16;

// DrumHeatFanChart
export const DRUM_GRID_LEFT = 36;
export const DRUM_GRID_RIGHT = 12;
export const DRUM_GRID_TOP = 20;
export const DRUM_GRID_BOTTOM = 40;
export const DRUM_AXIS_LABEL_FONT_SIZE = 10;
export const DRUM_X_FALLBACK_MIN = 0;
export const DRUM_X_FALLBACK_MAX = 1200;
export const DRUM_Y_MIN = 0;
export const DRUM_Y_MAX_C = 260;
export const DRUM_Y_MAX_F = 500;
export const POWER_Y_MIN = 0;
export const POWER_Y_MAX = 100;
export const DRUM_LINE_WIDTH = 3;
export const DRUM_LINE_SMOOTH = 0.3;
export const DRUM_MARK_LINE_WIDTH = 2;
