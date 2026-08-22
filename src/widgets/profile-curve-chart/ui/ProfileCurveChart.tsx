import { tempUnitLabel, toDisplayTemp, useRoastSettings } from '@features/active-roast';
import { formatElapsed } from '@shared/lib/format';
import { resolveColor } from '@shared/ui/Sparkline';
import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import { buildProfileCurvePlotData } from '../lib/buildPlotData';

/** Distinct overlay colors for multi-profile / multi-session compare. */
export const COMPARE_COLORS = [
    'var(--color-palette-blue)',
    'var(--color-palette-indigo)',
    'var(--color-palette-yellow)',
    'var(--color-palette-teal)',
] as const;

export interface SeriesData {
    curve: { t: number; bt: number }[];
    color: string;
    label: string;
}

interface ProfileCurveChartProps {
    series: SeriesData[];
}

export const ProfileCurveChart = ({ series }: ProfileCurveChartProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);
    const unit = useRoastSettings().temperatureUnit;
    const displaySeries = useMemo(
        () =>
            series.map((s) => ({
                ...s,
                curve: s.curve.map((p) => ({ t: p.t, bt: toDisplayTemp(p.bt, unit) })),
            })),
        [series, unit],
    );

    const plotDataKey = useMemo(
        () =>
            `${unit}|${displaySeries
                .map((s) => {
                    const last = s.curve[s.curve.length - 1];
                    return `${s.curve.length}:${s.curve[0]?.t ?? ''}:${last?.t ?? ''}:${s.curve[0]?.bt ?? ''}:${last?.bt ?? ''}`;
                })
                .join('|')}`,
        [displaySeries, unit],
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: series fingerprinted via plotDataKey to avoid parent inline-array churn
    useEffect(() => {
        const el = containerRef.current;
        if (!el || displaySeries.length === 0) return;

        const cs = getComputedStyle(document.documentElement);
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';
        const unitLabel = tempUnitLabel(unit);

        const { xs, ysArrays, yRange } = buildProfileCurvePlotData(displaySeries.map((s) => s.curve));

        const isMulti = displaySeries.length > 1;
        const resolvedColors = displaySeries.map((s) => resolveColor(s.color));

        const ttEl = document.createElement('div');
        Object.assign(ttEl.style, {
            position: 'absolute',
            pointerEvents: 'none',
            display: 'none',
            background: cs.getPropertyValue('--color-main-bg').trim() || 'white',
            borderRadius: '10px',
            padding: '10px 14px',
            boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
            fontSize: '12px',
            zIndex: '10',
            whiteSpace: 'nowrap',
        });

        const tooltipPlugin: uPlot.Plugin = {
            hooks: {
                init: [
                    (u) => {
                        u.root.style.position = 'relative';
                        u.root.appendChild(ttEl);
                    },
                ],
                setCursor: [
                    (u) => {
                        const { idx, left: cx, top: cy } = u.cursor;
                        if (idx == null || cx == null || cy == null) {
                            ttEl.style.display = 'none';
                            return;
                        }
                        const xSec = (u.data[0] as number[])[idx];
                        let html = `<div style="font-weight:500;color:${colorMuted};margin-bottom:4px">${formatElapsed(xSec)}</div>`;
                        displaySeries.forEach((ser, i) => {
                            const val = (u.data[i + 1] as (number | null)[])[idx];
                            if (val == null) return;
                            html += `<div style="display:flex;align-items:center;gap:6px;${i > 0 ? 'margin-top:3px' : ''}">
                                <div style="width:8px;height:8px;border-radius:2px;background:${resolvedColors[i]}"></div>
                                <span style="color:${colorMuted}">${isMulti ? ser.label : 'Bean Temp'}:</span>
                                <span style="font-weight:600;color:#171717">${val.toFixed(1)}${unitLabel}</span>
                            </div>`;
                        });
                        const tw = ttEl.offsetWidth || 160;
                        ttEl.innerHTML = html;
                        ttEl.style.display = 'block';
                        ttEl.style.left = `${cx + 12 + tw > u.width ? cx - tw - 12 : cx + 12}px`;
                        ttEl.style.top = `${Math.max(0, cy - 20)}px`;
                    },
                ],
            },
        };

        const opts: uPlot.Options = {
            width: el.clientWidth || el.offsetWidth,
            height: 160,
            padding: [4, 12, 0, 0],
            cursor: { focus: { prox: 16 }, drag: { x: false, y: false } },
            legend: { show: false },
            axes: [
                {
                    stroke: colorMuted,
                    grid: { stroke: 'rgba(0,0,0,0.05)', width: 1 },
                    ticks: { show: false },
                    border: { show: false },
                    font: '11px monospace',
                    size: 24,
                    incrs: [30, 60, 120, 180, 300],
                    values: (_, vals) => vals.map((v) => `${Math.floor(v / 60)}m`),
                },
                {
                    stroke: colorMuted,
                    grid: { show: false },
                    ticks: { show: false },
                    border: { show: false },
                    font: '11px monospace',
                    size: 32,
                    values: (_, vals) => vals.map((v) => `${v}°`),
                },
            ],
            scales: { x: { time: false }, y: { range: yRange } },
            series: [{}, ...resolvedColors.map((c) => ({ stroke: c, width: 2, points: { show: false } }))],
            plugins: [tooltipPlugin],
        };

        // biome-ignore lint/suspicious/noExplicitAny: uPlot data array has dynamic shape per series count
        plotRef.current = new uPlot(opts, [xs, ...ysArrays] as any, el);

        const obs = new ResizeObserver(() => {
            if (!plotRef.current || !el) return;
            const w = el.clientWidth;
            if (w <= 0) return;
            plotRef.current.setSize({ width: w, height: 160 });
        });
        obs.observe(el);

        return () => {
            obs.disconnect();
            plotRef.current?.destroy();
            plotRef.current = null;
        };
    }, [plotDataKey]);

    // min-w-0 + overflow-hidden: grid/flex parents default min-width:auto; uPlot canvas
    // otherwise locks the track width so shrink/zoom-out never fires a smaller size.
    return <div ref={containerRef} className="w-full min-w-0 overflow-hidden" />;
};
