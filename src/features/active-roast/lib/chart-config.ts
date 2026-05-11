export const CHART_COLORS = {
    btTarget: 'rgba(16,185,129,0.7)',
    btTargetTooltip: 'rgba(16,185,129,0.8)',
    btActual: '#1F2937',
    etActual: 'rgba(37,99,235,0.7)',
    rorActual: '#CA8A04',
    tp: '#16a34a',
    phaseLines: 'rgba(0,0,0,0.07)',
    currentTimeLine: 'rgba(0,0,0,0.3)',
} as const;

export const EVENT_MARKER_COLORS: Record<string, string> = {
    Yellow: '#ca8a04',
    'FC Start': '#ea580c',
    'FC End': '#dc2626',
    End: '#171717',
    Note: '#6b7280',
    TP: '#16a34a',
    Drop: '#78350f',
};

export const PHASE_SECS = [180, 300, 630] as const;
export const ROR_Y_MIN = -5;
export const ROR_Y_MAX = 20;
export const MARKER_LABEL_FONT_CSS_PX = 14;
export const MARKER_LABEL_Y_OFFSET_CSS_PX = 16;
