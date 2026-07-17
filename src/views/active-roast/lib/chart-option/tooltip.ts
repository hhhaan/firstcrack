import { CHART_COLORS } from '@features/active-roast/lib/chart-config';
import { fmtSec } from './axes';
import type { ControlData, ResolvedChartColors } from './types';

export interface TooltipFormatterParams {
    showET: boolean;
    showRoR: boolean;
    showRoRET: boolean;
    controlData?: ControlData;
    unitLabel: string;
    rorUnit: string;
    colors: ResolvedChartColors;
}

export const createAxisTooltipFormatter = (opts: TooltipFormatterParams) => {
    const { showET, showRoR, showRoRET, controlData, unitLabel, rorUnit, colors } = opts;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // biome-ignore lint/suspicious/noExplicitAny: ECharts tooltip params are loosely typed
    return (params: any) => {
        const timeSec = params[0]?.axisValue ?? 0;
        let html = `<div style="font-weight:500;color:${CHART_COLORS.tooltipTimeColor};margin-bottom:6px">${fmtSec(timeSec)}</div>`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: ECharts tooltip params are loosely typed
        for (const p of params as any[]) {
            const y = p.value?.[1];
            if (p.seriesName === 'BT Target' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.btTarget}"></div>Target BT: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
            if (p.seriesName === 'BT Actual' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.btActual}"></div>Bean Temp: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
            if (p.seriesName === 'ET Actual' && showET && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.etActual}"></div>Env Temp: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
            if (p.seriesName === 'RoR' && showRoR && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.rorActual}"></div>RoR: <span>${y.toFixed(1)}${rorUnit}</span></div>`;
            if (p.seriesName === 'ET RoR' && showRoRET && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.etActual}"></div>ET RoR: <span>${y.toFixed(1)}${rorUnit}</span></div>`;
            if (controlData && p.seriesName === 'Drum' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.controlDrum}"></div>Drum: <span>${y} RPM</span></div>`;
            if (controlData && p.seriesName === 'Heat' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.controlHeat}"></div>Heat: <span>${y}%</span></div>`;
            if (controlData && p.seriesName === 'Fan' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.controlFan}"></div>Fan: <span>${y}%</span></div>`;
        }
        return html;
    };
};
