import { SENSOR_COLORS, PHASE_COLORS, STATUS_COLORS } from './colors';

// ── Grid margins ─────────────────────────────────────────────────────────────
export const CHART_GRID_LEFT = 55;
export const CHART_GRID_TOP = 10;
/** 단일 Y축(온도만) 또는 오른쪽 보조축 없을 때 */
export const CHART_GRID_RIGHT = 12;
/** RoR·Power/Speed 등 오른쪽 보조 Y축 라벨+축명 공간 */
export const CHART_GRID_RIGHT_WITH_ROR = 50;
/** 오른쪽 축 제목(℃/min, % 등)과 눈금 사이 간격 — 상·하단 동일값 필수 */
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

export const CHART_COLORS = {
    btTarget: SENSOR_COLORS.btTarget,
    btTargetTooltip: SENSOR_COLORS.btTargetHover,
    btActual: SENSOR_COLORS.bt,
    etActual: SENSOR_COLORS.etChart,
    rorActual: SENSOR_COLORS.ror,
    tp: PHASE_COLORS.ready,
    phaseLines: 'rgba(0,0,0,0.07)',
    currentTimeLine: 'rgba(0,0,0,0.3)',
    nowLabel: STATUS_COLORS.active,
    gridLine: 'rgba(0,0,0,0.1)',
    gridLineMinor: 'rgba(0,0,0,0.04)',
    axisPointerLine: '#64748b',
    tooltipTimeColor: '#9ca3af',
    markerLabelColor: '#fff',
} as const;

export const CONTROL_COLORS = {
    drum: '#f59e0b',
    heat: '#ef4444',
    heatArea: 'rgba(239,68,68,0.15)',
    fan: '#3b82f6',
    fanArea: 'rgba(59,130,246,0.15)',
} as const;

export const EVENT_MARKER_COLORS: Record<string, string> = {
    Yellow: '#ca8a04',
    'FC Start': PHASE_COLORS.development,
    'FC End': PHASE_COLORS.danger,
    End: '#171717',
    Note: '#6b7280',
    TP: PHASE_COLORS.ready,
    Drop: '#78350f',
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
