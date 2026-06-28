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
        tp: gv('--color-event-tp', '#81FBA5'),
        phaseLines: gv('--color-chart-phaseline', 'rgba(0,0,0,0.07)'),
        currentTimeLine: gv('--color-chart-current-line', 'rgba(0,0,0,0.3)'),
        nowLabel: gv('--color-event-tp', '#81FBA5'),
        gridLine: gv('--color-chart-grid-stroke', 'rgba(0,0,0,0.05)'),
        gridLineMinor: gv('--color-chart-grid', 'rgba(0,0,0,0.05)'),
        axisLabel: gv('--color-chart-axis-label', '#666'),
        axisPointerLine: gv('--color-chart-axis-pointer', '#64748b'),
        tooltipTimeColor: gv('--color-chart-tooltip-time', '#9ca3af'),
        markerLabelColor: gv('--color-chart-marker-label', '#fff'),

        // Control chart colors
        controlDrum: gv('--color-control-drum', '#72EBBC'),
        controlHeat: gv('--color-control-heat', '#FFFF54'),
        controlHeatArea: gv('--color-control-heat-area', 'rgba(255,255,84,0.15)'),
        controlFan: gv('--color-control-fan', '#44BFFC'),
        controlFanArea: gv('--color-control-fan-area', 'rgba(68,191,252,0.15)'),

        // Event marker colors (resolved for canvas)
        eventYellow: gv('--color-event-yellow', '#FFFF54'),
        eventFcStart: gv('--color-event-fc-start', '#44BFFC'),
        eventFcEnd: gv('--color-event-fc-end', '#756AFC'),
        eventEnd: gv('--color-event-end', '#8080F0'),
        eventNote: gv('--color-event-note', '#72EBBC'),
        eventDrop: gv('--color-event-drop', '#A6B0FF'),
    };
};

/** Resolve a single event marker color to a raw hex/rgba value (for ECharts canvas) */
export const getResolvedEventColor = (event: string): string => {
    const varMap: Record<string, string> = {
        Yellow: '--color-event-yellow',
        'FC Start': '--color-event-fc-start',
        'FC End': '--color-event-fc-end',
        End: '--color-event-end',
        Note: '--color-event-note',
        TP: '--color-event-tp',
        Drop: '--color-event-drop',
    };
    const varName = varMap[event];
    if (!varName) return '#888';
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#888';
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
    axisPointerLine: 'var(--color-chart-axis-pointer)',
    tooltipTimeColor: 'var(--color-chart-tooltip-time)',
    markerLabelColor: 'var(--color-chart-marker-label)',
} as const;

export const CONTROL_COLORS = {
    drum: 'var(--color-control-drum)',
    heat: 'var(--color-control-heat)',
    heatArea: 'var(--color-control-heat-area)',
    fan: 'var(--color-control-fan)',
    fanArea: 'var(--color-control-fan-area)',
} as const;

export const EVENT_MARKER_COLORS: Record<string, string> = {
    Yellow: 'var(--color-event-yellow)',
    'FC Start': 'var(--color-event-fc-start)',
    'FC End': 'var(--color-event-fc-end)',
    End: 'var(--color-event-end)',
    Note: 'var(--color-event-note)',
    TP: 'var(--color-event-tp)',
    Drop: 'var(--color-event-drop)',
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
