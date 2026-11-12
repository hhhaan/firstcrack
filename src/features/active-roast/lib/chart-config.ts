import { isCustomRoastEvent } from './event-buttons';

// ── Grid margins ─────────────────────────────────────────────────────────────
/** Y-tick lines up with the roast title: 3-digit label plus AXIS_LABEL_MARGIN. */
export const CHART_GRID_LEFT = 32;
/** Gap between an axis tick label and the plot. */
export const AXIS_LABEL_MARGIN = 8;
export const CHART_GRID_TOP = 10;
export const CHART_GRID_RIGHT = 8;
export const CHART_GRID_RIGHT_WITH_ROR = 32;
export const Y_AXIS_NAME_GAP = 0;

/** Giesen-style phase line on the bottom edge of the temperature plot. */
export const PHASE_BAR_HEIGHT = 6;
/** BT, ET, RoR, and their reference curves. */
export const TEMP_CURVE_WIDTH = 2;
/** Heat, damper, drum, and their reference curves. */
export const CONTROL_CURVE_WIDTH = 2;
/** Vertical guides for heater, roast events, notes, and turning points. */
export const EVENT_MARK_LINE_WIDTH = 1;
/** Stored reference/profile curves. Channel color or gray, both at this opacity. */
export const REFERENCE_CURVE_OPACITY = 0.2;
/** Reference event guides, labels, and dots. Curves use {@link REFERENCE_CURVE_OPACITY}. */
export const REFERENCE_EVENT_OPACITY = 0.3;
/** Bundled number face. Axis ticks, times, temps, and control values. Not phase names in the DOM. */
export const NUMBER_FONT_FAMILY = 'Inconsolata';
/** In-plot words and numbers. Live curves stay at z 2; a focused compare curve stays at z 5. */
export const CHART_LABEL_Z = 10;
export const PHASE_BAR_FONT_FAMILY = NUMBER_FONT_FAMILY;
export const PHASE_BAR_FONT_WEIGHT = 600;

// ── Axis label typography ────────────────────────────────────────────────────
export const AXIS_LABEL_FONT = { fontSize: 14, fontWeight: 500, fontFamily: NUMBER_FONT_FAMILY } as const;

// ── Event annotations follow BT. Line style, and events with no BT sample, stack from the plot top.
export const MARKER_LABEL_FONT_SIZE = 12;
export const MARKER_LABEL_FONT_WEIGHT = 600;
export const MARKER_LABEL_FONT_FAMILY = NUMBER_FONT_FAMILY;
export const MARKER_LABEL_FONT =
    `${MARKER_LABEL_FONT_WEIGHT} ${MARKER_LABEL_FONT_SIZE}px ${MARKER_LABEL_FONT_FAMILY}` as const;

/** Compact previews may shrink labels; saved roast font settings remain 1–2. */
export const chartFontScale = (scale: number | undefined): number =>
    typeof scale === 'number' && Number.isFinite(scale) && scale >= 0.75 && scale <= 2 ? scale : 1;

/** Keep fractional pixels so each 1% step changes labels and their hit boxes together. */
export const scaleChartPx = (base: number, scale: number) => base * scale;

export const markerLabelFont = (scale: number) =>
    scale === 1
        ? MARKER_LABEL_FONT
        : `${MARKER_LABEL_FONT_WEIGHT} ${scaleChartPx(MARKER_LABEL_FONT_SIZE, scale)}px ${MARKER_LABEL_FONT_FAMILY}`;
/** Collision box height. The packer steps by this plus MARKER_LABEL_GAP_PX. */
export const MARKER_LABEL_STACK_PX = 17;
/** ASCII advance at MARKER_LABEL_FONT_SIZE. Hangul and other non-ASCII use the full em. */
export const MARKER_LABEL_CHAR_WIDTH_PX = 8;
export const MARKER_LABEL_MIN_WIDTH_PX = 8;
export const MARKER_LABEL_MAX_WIDTH_PX = 240;
export const MARKER_LABEL_GAP_PX = 2;
export const MARKER_LABEL_DISTANCE_PX = 0;
/** Preferred short leader from a roast milestone to its label, in CSS pixels. */
export const MARKER_LABEL_LEADER_X_PX = 16;
export const MARKER_LABEL_LEADER_Y_PX = 22;
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
// Defaults match controlChartHeightPct=21 (control ~21%, gap 3% under temp).
export const CONTROL_GRID_GAP_PCT = 3;
export const CONTROL_GRID_BOTTOM = 30;
export const MERGED_CONTROL_HEIGHT_RATIO = 0.25;

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
        btActual: gv('--color-sensor-bt', '#315dbe'),
        etActual: gv('--color-sensor-et', '#dc4729'),
        etRorActual: gv('--color-sensor-et-ror', '#315dbe'),
        rorActual: gv('--color-sensor-ror', '#dfa62f'),
        currentTimeLine: gv('--color-chart-current-line', 'rgba(0,0,0,0.3)'),
        gridLine: gv('--color-chart-grid-stroke', print ? '#d1d5db' : 'rgba(0,0,0,0.05)'),
        gridLineMinor: gv('--color-chart-grid', 'rgba(0,0,0,0.05)'),
        axisLabel: gv('--color-chart-axis-label', '#666'),
        axisPointerLine: gv('--color-chart-axis-pointer', '#64748b'),
        tooltipBg: gv('--color-chart-tooltip-bg', '#fff'),
        tooltipBorder: gv('--color-chart-tooltip-border', 'rgba(0,0,0,0.08)'),
        markerLabelColor: gv('--color-chart-marker-label', '#444'),

        // Stored reference/profile curves — neutral gray solid background line.
        reference: gv('--color-chart-axis-label', '#666'),

        // Phase bar (canvas — CSS vars do not resolve on canvas)
        phaseBarName: gv('--color-chart-phasebar-name', '#444'),
        phaseBarDrying: gv('--color-chart-phasebar-drying', 'oklch(0.88 0.19 95)'),
        phaseBarMaillard: gv('--color-chart-phasebar-maillard', 'oklch(0.74 0.11 225)'),
        phaseBarDevelopment: gv('--color-chart-phasebar-development', 'oklch(0.74 0.12 155)'),

        // Control chart colors
        controlDrum: gv('--color-control-drum', '#2e9566'),
        controlHeat: gv('--color-control-heat', '#dfa62f'),
        controlFan: gv('--color-control-fan', '#3e73c9'),

        // Event marker categories (resolved for canvas)
        eventMark: gv('--color-event-mark', '#777'),
        eventControl: gv('--color-event-control', '#c33'),
        // FC Start–End band fill on temp chart (lighter than phase bar)
        fcBandFill: gv('--color-fc-band-fill', 'rgba(0,157,76,0.1)'),
        bbpFill: gv('--color-bbp-fill', 'oklch(0.55 0 0 / 0.07)'),

        // BT−target delta label (canvas)
        targetDeltaWithin: gv('--color-phase-ready', '#81fba5'),
        targetDeltaOver: gv('--color-phase-danger', '#dc2626'),
        targetDeltaUnder: gv('--color-sensor-et', '#dc4729'),
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

export const isChartEventMarker = (event: string): boolean =>
    CHART_EVENT_MARKERS.has(event) || isCustomRoastEvent(event);

export const ROR_Y_MIN = -5;
export const ROR_Y_MAX = 20;
