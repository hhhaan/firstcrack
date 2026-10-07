import { CHART_COLORS } from '@features/active-roast/lib/chart-config';
import { type CurveLineStyle, curveSwatchCss, type ResolvedCurveStyles } from '@features/active-roast/lib/curve-style';
import { type ControlUnits, DEFAULT_CONTROL_UNITS, withUnit } from '../control-channels';
import { fmtSec } from './axes';
import type { ControlData } from './types';

const tooltipRow = (style: CurveLineStyle, label: string, value: string) =>
    `<div style="display:flex;gap:6px;align-items:center"><span style="${curveSwatchCss(style)}"></span>${label}: <span>${value}</span></div>`;

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
    curves: ResolvedCurveStyles;
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
    const { showET, showRoR, showRoRET, showControlHeat, controlData, unitLabel, rorUnit, curves, dataEndSec } = opts;
    const units = opts.controlUnits ?? DEFAULT_CONTROL_UNITS;
    const drum = (v: number) => withUnit(String(v), units.drum.unit);
    const heat = (v: number) => withUnit(String(v), units.heat.unit);
    const fan = (v: number) => withUnit(String(v), units.fan.unit);
    const temp = (y: number) => `${y.toFixed(1)}${unitLabel}`;
    const ror = (y: number) => `${y.toFixed(1)}${rorUnit}`;
    const control = !!controlData;
    const tooltipRows: Partial<
        Record<string, { style: CurveLineStyle; label: string; format: (y: number) => string; visible: boolean }>
    > = {
        'BT Target': { style: curves.bt.background, label: 'Target BT', format: temp, visible: true },
        'ET Target': { style: curves.et.background, label: 'Target ET', format: temp, visible: true },
        'RoR Target': { style: curves.ror.background, label: 'Target RoR', format: ror, visible: true },
        'Drum Target': { style: curves.drum.background, label: 'Target Drum', format: drum, visible: true },
        'Heater Target': { style: curves.heat.background, label: 'Target Heater', format: heat, visible: true },
        'Fan Target': { style: curves.fan.background, label: 'Target Fan', format: fan, visible: true },
        'BT Actual': { style: curves.bt.current, label: 'Bean Temp', format: temp, visible: true },
        'ET Actual': { style: curves.et.current, label: 'Env Temp', format: temp, visible: showET },
        RoR: { style: curves.ror.current, label: 'RoR', format: ror, visible: showRoR },
        'ET RoR': { style: curves.etRor.current, label: 'ET RoR', format: ror, visible: showRoRET },
        Drum: { style: curves.drum.current, label: 'Drum', format: drum, visible: control },
        Heat: { style: curves.heat.current, label: 'Heat', format: heat, visible: control },
        'Heat set': {
            style: { ...curves.heat.current, type: 'dashed' },
            label: 'Heat set',
            format: (y) => heat(Math.round(y)),
            visible: control,
        },
        Fan: { style: curves.fan.current, label: 'Fan', format: fan, visible: control },
    };

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
                html += tooltipRow(
                    { ...curves.heat.current, type: 'dotted' },
                    'Heat target',
                    heat(Math.round(target.values[i])),
                );
                break;
            }
        }

        // biome-ignore lint/suspicious/noExplicitAny: ECharts tooltip params are loosely typed
        for (const p of items as any[]) {
            const y = p.value?.[1];
            if (y == null) continue;
            const row = tooltipRows[p.seriesName];
            if (row?.visible) html += tooltipRow(row.style, row.label, row.format(y));
        }
        return html;
    };
};
