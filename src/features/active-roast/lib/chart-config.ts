import { SENSOR_COLORS, PHASE_COLORS, STATUS_COLORS } from './colors';

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
