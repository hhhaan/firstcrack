import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

const Y_MIN = -5;
const Y_MAX = 20;

interface Props {
    xs: number[];
    rorActual: (number | null)[];
    etRorActual: (number | null)[];
    height?: number;
}

export const RoastRorChart = ({ xs, rorActual, etRorActual, height = 80 }: Props) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const cs = getComputedStyle(document.documentElement);
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';

        const ttEl = document.createElement('div');
        Object.assign(ttEl.style, {
            position: 'absolute',
            pointerEvents: 'none',
            display: 'none',
            background: 'white',
            borderRadius: '8px',
            padding: '6px 10px',
            boxShadow: 'rgba(0,0,0,0.15) 0px 2px 8px',
            fontSize: '12px',
            fontWeight: '600',
            color: '#d97706',
            zIndex: '10',
            whiteSpace: 'nowrap',
        });

        const zeroLinePlugin: uPlot.Plugin = {
            hooks: {
                draw: [(u) => {
                    const { ctx } = u;
                    const { top, height: bh, left, width: bw } = u.bbox;
                    const y0 = u.valToPos(0, 'y', true);
                    if (y0 >= top && y0 <= top + bh) {
                        ctx.save();
                        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
                        ctx.setLineDash([3, 3]);
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(left, y0);
                        ctx.lineTo(left + bw, y0);
                        ctx.stroke();
                        ctx.restore();
                    }
                }],
            },
        };

        const tooltipPlugin: uPlot.Plugin = {
            hooks: {
                init: [(u) => { u.root.style.position = 'relative'; u.root.appendChild(ttEl); }],
                setCursor: [(u) => {
                    const { idx, left: cx, top: cy } = u.cursor;
                    if (idx == null || cx == null || cy == null) { ttEl.style.display = 'none'; return; }
                    const btRor = (u.data[1] as (number | null)[])[idx];
                    const etRor = (u.data[2] as (number | null)[])[idx];
                    if (btRor == null && etRor == null) { ttEl.style.display = 'none'; return; }
                    const parts = [];
                    if (btRor != null) parts.push(`BT ${btRor.toFixed(1)}°/min`);
                    if (etRor != null) parts.push(`ET ${etRor.toFixed(1)}°/min`);
                    ttEl.textContent = parts.join('  ');
                    ttEl.style.display = 'block';
                    ttEl.style.left = `${cx + 10}px`;
                    ttEl.style.top = `${Math.max(0, cy - 20)}px`;
                }],
            },
        };

        const opts: uPlot.Options = {
            width: el.offsetWidth,
            height,
            padding: [8, 12, 8, 0],
            cursor: { focus: { prox: 16 }, drag: { x: false, y: false } },
            legend: { show: false },
            axes: [
                { show: false },
                {
                    stroke: colorMuted,
                    grid: { show: false },
                    ticks: { show: false },
                    border: { show: false },
                    font: '10px monospace',
                    size: 36,
                    splits: [Y_MIN, 0, Y_MAX],
                    values: (_, vals) => vals.map(String),
                },
            ],
            scales: {
                x: { time: false },
                y: { range: [Y_MIN, Y_MAX] },
            },
            series: [
                {},
                {
                    stroke: '#d97706',
                    width: 1.5,
                    fill: (u) => {
                        const gradient = u.ctx.createLinearGradient(0, 0, 0, u.height);
                        gradient.addColorStop(0, 'rgba(217,119,6,0.3)');
                        gradient.addColorStop(1, 'rgba(217,119,6,0.02)');
                        return gradient;
                    },
                    points: { show: false },
                },
                {
                    stroke: '#3b82f6',
                    width: 1.5,
                    dash: [4, 3],
                    points: { show: false },
                },
            ],
            plugins: [zeroLinePlugin, tooltipPlugin],
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current = new uPlot(opts, [xs, rorActual, etRorActual] as any, el);

        const obs = new ResizeObserver(() => {
            if (plotRef.current && el) plotRef.current.setSize({ width: el.offsetWidth, height: plotRef.current.height });
        });
        obs.observe(el);

        return () => { obs.disconnect(); plotRef.current?.destroy(); plotRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current?.setData([xs, rorActual, etRorActual] as any);
    }, [xs, rorActual, etRorActual]);

    useEffect(() => {
        if (plotRef.current) {
            plotRef.current.setSize({ width: containerRef.current?.offsetWidth ?? plotRef.current.width, height });
        }
    }, [height]);

    return <div ref={containerRef} className="w-full" />;
};
