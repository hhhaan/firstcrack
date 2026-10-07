import { CHART_COLORS, REFERENCE_CURVE_OPACITY } from '@features/active-roast/lib/chart-config';
import { type ControlUnits, DEFAULT_CONTROL_UNITS, withUnit } from '../control-channels';
import { fmtSec } from './axes';
import type { ControlData, ResolvedChartColors } from './types';

const DRAWN_TOOLTIP_SERIES = new Set(['BT Actual', 'ET Actual', 'RoR', 'ET RoR', 'Drum', 'Heat', 'Heat set', 'Fan']);

export interface TooltipFormatterParams {
    showET: boolean;
    showRoR: boolean;
    showRoRET: boolean;
    /** Heat 시리즈를 끈 상태에서는 목표 행도 숨긴다. 선과 툴팁이 같은 토글을 따른다. */
    showControlHeat: boolean;
    controlData?: ControlData;
    /** Same units the control axes and readout use. */
    controlUnits?: ControlUnits;
    unitLabel: string;
    rorUnit: string;
    colors: ResolvedChartColors;
    /** Last x with a drawn actual/control sample. Hover past this hides the tooltip. */
    dataEndSec: number;
}

const lastNonNullTime = (xs: number[], series: readonly (readonly (number | null)[])[]): number => {
    for (let i = xs.length - 1; i >= 0; i--) {
        for (const s of series) {
            if (s[i] != null) return xs[i];
        }
    }
    return Number.NEGATIVE_INFINITY;
};

/** Last time with a real temp or control value — skips trailing empty axis sentinels. */
export const lastDrawnSampleSec = (
    xs: number[],
    valueSeries: readonly (readonly (number | null)[])[],
    controlData?: ControlData,
): number => {
    const fromTemp = lastNonNullTime(xs, valueSeries);
    if (!controlData) return fromTemp;
    const fromControl = lastNonNullTime(controlData.xs, [
        controlData.drumTemp,
        controlData.heatPower,
        controlData.fanSpeed,
        controlData.heatSet ?? [],
    ]);
    return Math.max(fromTemp, fromControl);
};

export const createAxisTooltipFormatter = (opts: TooltipFormatterParams) => {
    const { showET, showRoR, showRoRET, showControlHeat, controlData, unitLabel, rorUnit, colors, dataEndSec } = opts;
    const units = opts.controlUnits ?? DEFAULT_CONTROL_UNITS;
    const drum = (v: number) => withUnit(String(v), units.drum.unit);
    const heat = (v: number) => withUnit(String(v), units.heat.unit);
    const fan = (v: number) => withUnit(String(v), units.fan.unit);

    // biome-ignore lint/suspicious/noExplicitAny: ECharts tooltip params are loosely typed
    return (params: any) => {
        const items = Array.isArray(params) ? params : [params];
        const timeSec = Number(items[0]?.axisValue ?? items[0]?.value?.[0] ?? 0);
        if (!Number.isFinite(timeSec) || timeSec > dataEndSec) return '';
        const hasDrawn = items.some(
            (p: { seriesName?: string; value?: [number, number | null] }) =>
                !!p.seriesName && DRAWN_TOOLTIP_SERIES.has(p.seriesName) && p.value?.[1] != null,
        );
        if (!hasDrawn) return '';

        let html = `<div style="font-weight:500;color:${CHART_COLORS.tooltipTimeColor};margin-bottom:6px">${fmtSec(timeSec)}</div>`;

        const target = showControlHeat ? controlData?.heatTarget : undefined;
        if (target && timeSec <= target.xs[target.xs.length - 1]) {
            for (let i = target.xs.length - 1; i >= 0; i--) {
                if (timeSec < target.xs[i]) continue;
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;box-sizing:border-box;border:1px dotted ${colors.controlHeat}"></div>Heat target: <span>${heat(Math.round(target.values[i]))}</span></div>`;
                break;
            }
        }

        // biome-ignore lint/suspicious/noExplicitAny: ECharts tooltip params are loosely typed
        for (const p of items as any[]) {
            const y = p.value?.[1];
            if (p.seriesName === 'BT Target' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.reference};opacity:${REFERENCE_CURVE_OPACITY}"></div>Target BT: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
            if (p.seriesName === 'ET Target' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.reference};opacity:${REFERENCE_CURVE_OPACITY}"></div>Target ET: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
            if (p.seriesName === 'RoR Target' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.reference};opacity:${REFERENCE_CURVE_OPACITY}"></div>Target RoR: <span>${y.toFixed(1)}${rorUnit}</span></div>`;
            if (p.seriesName === 'Drum Target' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.reference};opacity:${REFERENCE_CURVE_OPACITY}"></div>Target Drum: <span>${drum(y)}</span></div>`;
            if (p.seriesName === 'Heater Target' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.reference};opacity:${REFERENCE_CURVE_OPACITY}"></div>Target Heater: <span>${heat(y)}</span></div>`;
            if (p.seriesName === 'Fan Target' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.reference};opacity:${REFERENCE_CURVE_OPACITY}"></div>Target Fan: <span>${fan(y)}</span></div>`;
            if (p.seriesName === 'BT Actual' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.btActual}"></div>Bean Temp: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
            if (p.seriesName === 'ET Actual' && showET && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.etActual}"></div>Env Temp: <span>${y.toFixed(1)}${unitLabel}</span></div>`;
            if (p.seriesName === 'RoR' && showRoR && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${CHART_COLORS.rorActual}"></div>RoR: <span>${y.toFixed(1)}${rorUnit}</span></div>`;
            if (p.seriesName === 'ET RoR' && showRoRET && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.etActual}"></div>ET RoR: <span>${y.toFixed(1)}${rorUnit}</span></div>`;
            if (controlData && p.seriesName === 'Drum' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.controlDrum}"></div>Drum: <span>${drum(y)}</span></div>`;
            if (controlData && p.seriesName === 'Heat' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.controlHeat}"></div>Heat: <span>${heat(y)}</span></div>`;
            if (controlData && p.seriesName === 'Heat set' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;box-sizing:border-box;border:1px dashed ${colors.controlHeat}"></div>Heat set: <span>${heat(Math.round(y))}</span></div>`;
            if (controlData && p.seriesName === 'Fan' && y != null)
                html += `<div style="display:flex;gap:6px;align-items:center"><div style="width:8px;height:8px;background:${colors.controlFan}"></div>Fan: <span>${fan(y)}</span></div>`;
        }
        return html;
    };
};
