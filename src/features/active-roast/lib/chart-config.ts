// ── Grid margins ─────────────────────────────────────────────────────────────
export const CHART_GRID_LEFT = 38;
export const CHART_GRID_TOP = 10;
export const CHART_GRID_RIGHT = 8;
export const CHART_GRID_RIGHT_WITH_ROR = 32;
export const Y_AXIS_NAME_GAP = 0;

// ── Phase bar dimensions & text style (temp-grid overlay strip) ──────────────
export const PHASE_BAR_HEIGHT = 26;
export const PHASE_BAR_WIDE_THRESHOLD = 70;
export const PHASE_BAR_NARROW_THRESHOLD = 30;
export const PHASE_BAR_TEXT_INSET = 6;
/** @deprecated Prefer getResolvedChartColors().phaseBarStroke — kept for non-canvas fallbacks */
export const PHASE_BAR_STROKE = 'var(--color-chart-phasebar-stroke)';
export const PHASE_BAR_STROKE_WIDTH = 0.5;
/** @deprecated Prefer getResolvedChartColors().phaseBarName */
export const PHASE_BAR_NAME_COLOR = 'var(--color-chart-phasebar-name)';
/** @deprecated Prefer getResolvedChartColors().phaseBarDuration */
export const PHASE_BAR_DURATION_COLOR = 'var(--color-chart-phasebar-duration)';
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
/** Temp Y grid line step (display unit). Labels use TEMP_Y_LABEL_INTERVAL only. */
export const TEMP_Y_INTERVAL = 10;
/** Temp Y axis labels only at multiples of this (e.g. 50, 100, … not axis min). */
export const TEMP_Y_LABEL_INTERVAL = 50;
/** Major tick / axis label step (sec). Grid lines also draw at half-step via minorSplitLine. */
export const TIME_X_INTERVAL_SEC = 60;
/** Half-steps between time majors → time grid every 30s. */
export const AXIS_MINOR_SPLIT_NUMBER = 2;

// ── Multi-grid layout proportions (controlData mode) ────────────────────────
// Defaults match controlChartHeightPct=21 (control ~21%, gap 3% under temp).
export const CONTROL_GRID_GAP_PCT = 3;
export const CONTROL_GRID_BOTTOM = 30;

/** Map control band height % → temp/control grid tops. */
export function getControlGridLayout(heightPct: number): {
    tempGridHeight: string;
    controlGridTop: string;
} {
    const h = Math.min(40, Math.max(12, heightPct));
    const controlTop = 100 - h;
    const tempHeight = Math.max(40, controlTop - CONTROL_GRID_GAP_PCT);
    return {
        tempGridHeight: `${tempHeight}%`,
        controlGridTop: `${controlTop}%`,
    };
}

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
        btTarget: gv('--color-sensor-bt-target', 'rgba(0,157,76,0.55)'),
        btTargetTooltip: gv('--color-sensor-bt-target-hover', 'rgba(0,157,76,0.75)'),
        btActual: gv('--color-sensor-bt', '#009d4c'),
        etActual: gv('--color-sensor-et', '#0091cb'),
        rorActual: gv('--color-sensor-ror', '#e7ae00'),
        tp: gv('--color-event-tp', '#009d4c'),
        phaseLines: gv('--color-chart-phaseline', 'rgba(0,0,0,0.07)'),
        currentTimeLine: gv('--color-chart-current-line', 'rgba(0,0,0,0.3)'),
        nowLabel: gv('--color-event-tp', '#009d4c'),
        gridLine: gv('--color-chart-grid-stroke', 'rgba(0,0,0,0.05)'),
        gridLineMinor: gv('--color-chart-grid', 'rgba(0,0,0,0.05)'),
        axisLabel: gv('--color-chart-axis-label', '#666'),
        axisPointerLine: gv('--color-chart-axis-pointer', '#64748b'),
        tooltipTimeColor: gv('--color-chart-tooltip-time', '#9ca3af'),
        tooltipBg: gv('--color-chart-tooltip-bg', '#fff'),
        tooltipBorder: gv('--color-chart-tooltip-border', 'rgba(0,0,0,0.08)'),
        markerLabelColor: gv('--color-chart-marker-label', '#fff'),

        // Phase bar (canvas — CSS vars do not resolve on canvas)
        phaseBarStroke: gv('--color-chart-phasebar-stroke', 'rgba(0,0,0,0.08)'),
        phaseBarName: gv('--color-chart-phasebar-name', '#444'),
        phaseBarDuration: gv('--color-chart-phasebar-duration', '#555'),

        // Control chart colors
        controlDrum: gv('--color-control-drum', '#00a36d'),
        controlHeat: gv('--color-control-heat', '#e7ae00'),
        controlHeatArea: gv('--color-control-heat-area', 'rgba(231,174,0,0.22)'),
        controlFan: gv('--color-control-fan', '#0091cb'),
        controlFanArea: gv('--color-control-fan-area', 'rgba(0,145,203,0.22)'),

        // Event marker colors (resolved for canvas)
        eventYellow: gv('--color-event-yellow', '#e7ae00'),
        eventFcStart: gv('--color-event-fc-start', '#0091cb'),
        eventFcEnd: gv('--color-event-fc-end', '#6967e1'),
        eventEnd: gv('--color-event-end', '#626fd2'),
        eventNote: gv('--color-event-note', '#00a36d'),
        eventDrop: gv('--color-event-drop', '#7483e0'),
        // FC Start–End band fill on temp chart (lighter than phase bar)
        fcBandFill: gv('--color-fc-band-fill', 'rgba(105,103,225,0.1)'),
    };
};

/** Resolve a single event marker color to a raw hex/rgba value (for ECharts canvas) */
export const getResolvedEventColor = (event: string): string => {
    const varMap: Record<string, string> = {
        Charge: '--color-event-charge',
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
    Charge: 'var(--color-event-charge)',
    Yellow: 'var(--color-event-yellow)',
    'FC Start': 'var(--color-event-fc-start)',
    'FC End': 'var(--color-event-fc-end)',
    End: 'var(--color-event-end)',
    Note: 'var(--color-event-note)',
    TP: 'var(--color-event-tp)',
    Drop: 'var(--color-event-drop)',
};

/** Logged but not drawn as chart markLines (TP is separate series; Note is free text). */
export const MARKER_EXCLUDED_EVENTS = new Set(['TP', 'Note']);

export const isChartEventMarker = (event: string): boolean =>
    Boolean(EVENT_MARKER_COLORS[event]) && !MARKER_EXCLUDED_EVENTS.has(event);

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
