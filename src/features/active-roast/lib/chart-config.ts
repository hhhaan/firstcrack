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
export const PHASE_BAR_STROKE_WIDTH = 0.5;
/** BT, ET, RoR, and their reference curves. */
export const TEMP_CURVE_WIDTH = 1.8;
/** Heat, damper, drum, and their reference curves. */
export const CONTROL_CURVE_WIDTH = 1.5;
/** Vertical guides for heater, roast events, notes, and turning points. */
export const EVENT_MARK_LINE_WIDTH = 1;
export const PHASE_BAR_FONT_SIZE = 10;
export const PHASE_BAR_FONT_SIZE_NARROW = 9;
export const PHASE_BAR_FONT_FAMILY = 'monospace';
export const PHASE_BAR_FONT_WEIGHT = 600;

// ── Axis label typography ────────────────────────────────────────────────────
export const AXIS_LABEL_FONT = { fontSize: 11, fontFamily: 'monospace' as const } as const;
export const AXIS_LABEL_FONT_SM = { fontSize: 10, fontFamily: 'monospace' as const } as const;

// ── Curve event labels (`이름|mm:ss|온도`). Axis ticks and the phase bar stay put.
export const MARKER_LABEL_FONT_SIZE = 10;
export const MARKER_LABEL_FONT_WEIGHT = 600;
export const MARKER_LABEL_FONT_FAMILY = 'monospace';
export const MARKER_LABEL_FONT =
    `${MARKER_LABEL_FONT_WEIGHT} ${MARKER_LABEL_FONT_SIZE}px ${MARKER_LABEL_FONT_FAMILY}` as const;

/** Roast font setting → chart scale. Anything else stays at 1 so layout tests keep base pixels. */
export const chartFontScale = (scale: number | undefined): number =>
    typeof scale === 'number' && Number.isFinite(scale) && scale >= 1 && scale <= 2 ? scale : 1;

/** Keep fractional pixels so each 1% step changes labels and their hit boxes together. */
export const scaleChartPx = (base: number, scale: number) => base * scale;

export const markerLabelFont = (scale: number) =>
    scale === 1
        ? MARKER_LABEL_FONT
        : `${MARKER_LABEL_FONT_WEIGHT} ${scaleChartPx(MARKER_LABEL_FONT_SIZE, scale)}px ${MARKER_LABEL_FONT_FAMILY}`;
/** Collision box height. The packer steps by this plus MARKER_LABEL_GAP_PX. */
export const MARKER_LABEL_STACK_PX = 14;
/** ASCII advance at MARKER_LABEL_FONT_SIZE. Hangul and other non-ASCII use the full em. */
export const MARKER_LABEL_CHAR_WIDTH_PX = 6;
export const MARKER_LABEL_MIN_WIDTH_PX = 8;
export const MARKER_LABEL_MAX_WIDTH_PX = 240;
export const MARKER_LABEL_GAP_PX = 2;
export const MARKER_LABEL_DISTANCE_PX = 0;
/** Event line → label, and the canvas edge inset. */
export const MARKER_LABEL_X_OFFSET_PX = 4;
export const MARKER_LABEL_CANVAS_GUTTER_PX = MARKER_LABEL_X_OFFSET_PX * 2;

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
// Defaults match controlChartHeightPct=21 (control ~21%, gap 5% under temp —
// the gap holds the control axis unit names).
export const CONTROL_GRID_GAP_PCT = 5;
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
export const getResolvedChartColors = (print = false) => {
    const root = print ? null : getComputedStyle(document.documentElement);
    const gv = (key: string, fallback: string) => {
        const val = root?.getPropertyValue(key).trim();
        return val || fallback;
    };

    return {
        btTarget: gv('--color-sensor-bt-target', 'rgba(0,157,76,0.55)'),
        btTargetTooltip: gv('--color-sensor-bt-target', 'rgba(0,157,76,0.55)'),
        btActual: gv('--color-sensor-bt', '#009d4c'),
        etActual: gv('--color-sensor-et', '#0091cb'),
        etTarget: gv('--color-sensor-et-target', 'oklch(0.6 0.17 225 / 0.55)'),
        rorActual: gv('--color-sensor-ror', '#e7ae00'),
        rorTarget: gv('--color-sensor-ror-target', 'oklch(0.78 0.18 88 / 0.55)'),
        tp: gv('--color-event-mark', '#777'),
        phaseLines: gv('--color-chart-phaseline', 'rgba(0,0,0,0.07)'),
        currentTimeLine: gv('--color-chart-current-line', 'rgba(0,0,0,0.3)'),
        nowLabel: gv('--color-phase-ready', '#009d4c'),
        gridLine: gv('--color-chart-grid-stroke', 'rgba(0,0,0,0.05)'),
        gridLineMinor: gv('--color-chart-grid', 'rgba(0,0,0,0.05)'),
        axisLabel: gv('--color-chart-axis-label', '#666'),
        axisPointerLine: gv('--color-chart-axis-pointer', '#64748b'),
        tooltipTimeColor: gv('--color-chart-tooltip-time', '#9ca3af'),
        tooltipBg: gv('--color-chart-tooltip-bg', '#fff'),
        tooltipBorder: gv('--color-chart-tooltip-border', 'rgba(0,0,0,0.08)'),
        markerLabelColor: gv('--color-chart-marker-label', '#444'),

        // Phase bar (canvas — CSS vars do not resolve on canvas)
        phaseBarStroke: gv('--color-chart-phasebar-stroke', 'rgba(0,0,0,0.08)'),
        phaseBarName: gv('--color-chart-phasebar-name', '#444'),
        phaseBarDuration: gv('--color-chart-phasebar-duration', '#555'),

        // Control chart colors
        controlDrum: gv('--color-control-drum', '#00a36d'),
        controlDrumTarget: gv('--color-control-drum-target', 'oklch(0.62 0.16 165 / 0.55)'),
        controlHeat: gv('--color-control-heat', '#e7ae00'),
        controlHeatTarget: gv('--color-control-heat-target', 'oklch(0.78 0.18 88 / 0.55)'),
        controlHeatArea: gv('--color-control-heat-area', 'rgba(231,174,0,0.22)'),
        controlFan: gv('--color-control-fan', '#0091cb'),
        controlFanTarget: gv('--color-control-fan-target', 'oklch(0.6 0.17 225 / 0.55)'),
        controlFanArea: gv('--color-control-fan-area', 'rgba(0,145,203,0.22)'),
        /** Outline behind on-curve value labels so they stay legible over grid and curves. */
        controlLabelHalo: gv('--color-roast-bg', '#ffffff'),

        // Event marker categories (resolved for canvas)
        eventMark: gv('--color-event-mark', '#777'),
        eventControl: gv('--color-event-control', '#c33'),
        // FC Start–End band fill on temp chart (lighter than phase bar)
        fcBandFill: gv('--color-fc-band-fill', 'rgba(0,157,76,0.1)'),
        bbpFill: gv('--color-bbp-fill', 'oklch(0.55 0 0 / 0.07)'),

        // BT−target delta label (canvas)
        targetDeltaWithin: gv('--color-phase-ready', '#81fba5'),
        targetDeltaOver: gv('--color-phase-danger', '#dc2626'),
        targetDeltaUnder: gv('--color-sensor-et', '#0091cb'),
    };
};

export const isControlEvent = (event: string): boolean => event === 'Heater';

export const eventMarkerCssColor = (event: string): string =>
    `var(${isControlEvent(event) ? '--color-event-control' : '--color-event-mark'})`;

/** Resolve a single event marker color to a raw color value for ECharts canvas. */
export const getResolvedEventColor = (event: string): string => {
    const token = isControlEvent(event) ? '--color-event-control' : '--color-event-mark';
    return (
        getComputedStyle(document.documentElement).getPropertyValue(token).trim() ||
        (isControlEvent(event) ? '#b33' : '#888')
    );
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

const CHART_EVENT_MARKERS = new Set([
    'Charge',
    'Yellow',
    'FC Start',
    'FC Rolling',
    'FC End',
    'Drop',
    'End',
    'Note',
    'Heater',
]);

export const isChartEventMarker = (event: string): boolean => CHART_EVENT_MARKERS.has(event);

export const PHASE_SECS = [180, 300, 630] as const;
export const ROR_Y_MIN = -5;
export const ROR_Y_MAX = 20;

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
