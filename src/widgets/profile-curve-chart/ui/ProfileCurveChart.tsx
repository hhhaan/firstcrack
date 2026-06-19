import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import { resolveColor } from '@shared/ui/Sparkline';

export const COMPARE_COLORS = [
    'var(--color-palette-green)',
    'var(--color-palette-blue)',
    'var(--color-palette-purple)',
    'var(--color-palette-yellow)',
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

    useEffect(() => {
        const el = containerRef.current;
        if (!el || series.length === 0) return;

        const cs = getComputedStyle(document.documentElement);
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';

        const maxT = Math.max(...series.map((s) => s.curve[s.curve.length - 1]?.t ?? 0));
        const xs: number[] = [];
        for (let t = 0; t <= maxT; t += 30) xs.push(t);

        const ysArrays = series.map((s) => {
            const map = new Map(s.curve.map((pt) => [pt.t, pt.bt]));
            return xs.map((t) => map.get(t) ?? null);
        });

        const isMulti = series.length > 1;
        const resolvedColors = series.map((s) => resolveColor(s.color));

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
                        const m = Math.floor(xSec / 60);
                        const s = Math.round(xSec % 60);
                        let html = `<div style="font-weight:500;color:${colorMuted};margin-bottom:4px">${m}:${String(s).padStart(2, '0')}</div>`;
                        series.forEach((ser, i) => {
                            const val = (u.data[i + 1] as (number | null)[])[idx];
                            if (val == null) return;
                            html += `<div style="display:flex;align-items:center;gap:6px;${i > 0 ? 'margin-top:3px' : ''}">
                                <div style="width:8px;height:8px;border-radius:2px;background:${resolvedColors[i]}"></div>
                                <span style="color:${colorMuted}">${isMulti ? ser.label : 'Bean Temp'}:</span>
                                <span style="font-weight:600;color:#171717">${val.toFixed(1)}°C</span>
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
            width: el.offsetWidth,
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
            scales: { x: { time: false }, y: { range: [140, 230] } },
            series: [{}, ...resolvedColors.map((c) => ({ stroke: c, width: 2, points: { show: false } }))],
            plugins: [tooltipPlugin],
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current = new uPlot(opts, [xs, ...ysArrays] as any, el);

        const obs = new ResizeObserver(() => {
            if (plotRef.current && el) plotRef.current.setSize({ width: el.offsetWidth, height: 160 });
        });
        obs.observe(el);

        return () => {
            obs.disconnect();
            plotRef.current?.destroy();
            plotRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div ref={containerRef} className="w-full" />;
};
