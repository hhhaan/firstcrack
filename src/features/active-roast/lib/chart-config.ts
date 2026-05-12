import { SENSOR_COLORS, PHASE_COLORS } from './colors';

export const CHART_COLORS = {
    btTarget: SENSOR_COLORS.btTarget,
    btTargetTooltip: SENSOR_COLORS.btTargetHover,
    btActual: SENSOR_COLORS.bt,
    etActual: SENSOR_COLORS.etChart,
    rorActual: SENSOR_COLORS.ror,
    tp: PHASE_COLORS.ready,
    phaseLines: 'rgba(0,0,0,0.07)',
    currentTimeLine: 'rgba(0,0,0,0.3)',
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
