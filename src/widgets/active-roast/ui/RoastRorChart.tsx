import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

interface Props {
    xs: number[];
    rorActual: (number | null)[];
    height?: number;
}

export const RoastRorChart = ({ xs, rorActual, height = 80 }: Props) => {
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
                    const v = (u.data[1] as (number | null)[])[idx];
                    if (v == null) { ttEl.style.display = 'none'; return; }
                    ttEl.textContent = `${v.toFixed(1)}°/min`;
                    ttEl.style.display = 'block';
                    ttEl.style.left = `${cx + 10}px`;
                    ttEl.style.top = `${Math.max(0, cy - 20)}px`;
                }],
            },
        };

        const opts: uPlot.Options = {
            width: el.offsetWidth,
            height,
            padding: [2, 12, 0, 0],
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
                    values: (_, vals) => vals.map(String),
                },
            ],
            scales: {
                x: { time: false },
                y: { auto: true },
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
            ],
            plugins: [zeroLinePlugin, tooltipPlugin],
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current = new uPlot(opts, [xs, rorActual] as any, el);

        const obs = new ResizeObserver(() => {
            if (plotRef.current && el) plotRef.current.setSize({ width: el.offsetWidth, height: plotRef.current.height });
        });
        obs.observe(el);

        return () => { obs.disconnect(); plotRef.current?.destroy(); plotRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current?.setData([xs, rorActual] as any);
    }, [xs, rorActual]);

    useEffect(() => {
        if (plotRef.current) {
            plotRef.current.setSize({ width: containerRef.current?.offsetWidth ?? plotRef.current.width, height });
        }
    }, [height]);

    return <div ref={containerRef} className="w-full" />;
};
