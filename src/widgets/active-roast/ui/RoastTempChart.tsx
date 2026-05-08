import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

export interface RoastEventMarker {
    timeSec: number;
    event: string;
    color: string;
}

interface Props {
    xs: number[];
    btTarget: (number | null)[];
    btActual: (number | null)[];
    etActual: (number | null)[];
    currentTimeSec: number;
    eventMarkers: RoastEventMarker[];
    height: number;
    onCursorIdx?: (idx: number | null) => void;
}

const PHASE_SECS = [180, 300, 630];

const fmtSec = (v: number) => {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

export const RoastTempChart = ({ xs, btTarget, btActual, etActual, currentTimeSec, eventMarkers, height, onCursorIdx }: Props) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    // Mutable refs so plugin hooks always read latest values without recreating uPlot
    const currentTimeRef = useRef(currentTimeSec);
    const eventMarkersRef = useRef(eventMarkers);
    const onCursorIdxRef = useRef(onCursorIdx);
    currentTimeRef.current = currentTimeSec;
    eventMarkersRef.current = eventMarkers;
    onCursorIdxRef.current = onCursorIdx;

    // Create uPlot once on mount
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const cs = getComputedStyle(document.documentElement);
        const colorPrimary = cs.getPropertyValue('--color-primary').trim() || '#171717';
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';
        const colorSecondary = cs.getPropertyValue('--color-secondary').trim() || '#6b7280';

        // --- Tooltip ---
        const ttEl = document.createElement('div');
        Object.assign(ttEl.style, {
            position: 'absolute',
            pointerEvents: 'none',
            display: 'none',
            background: 'white',
            borderRadius: '10px',
            padding: '10px 14px',
            boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
            fontSize: '12px',
            zIndex: '10',
            whiteSpace: 'nowrap',
        });

        // --- Plugins ---
        const refLinePlugin: uPlot.Plugin = {
            hooks: {
                draw: [(u) => {
                    const { ctx } = u;
                    const { top, height: bh, left, width: bw } = u.bbox;
                    ctx.save();

                    // Phase boundary lines
                    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
                    ctx.setLineDash([3, 3]);
                    ctx.lineWidth = 1;
                    for (const sec of PHASE_SECS) {
                        const x = u.valToPos(sec, 'x', true);
                        if (x < left || x > left + bw) continue;
                        ctx.beginPath();
                        ctx.moveTo(x, top);
                        ctx.lineTo(x, top + bh);
                        ctx.stroke();
                    }

                    // Current time marker
                    const ct = currentTimeRef.current;
                    if (ct > 0) {
                        const cx = u.valToPos(ct, 'x', true);
                        if (cx >= left && cx <= left + bw) {
                            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                            ctx.setLineDash([4, 3]);
                            ctx.lineWidth = 1.5;
                            ctx.beginPath();
                            ctx.moveTo(cx, top);
                            ctx.lineTo(cx, top + bh);
                            ctx.stroke();
                        }
                    }

                    // Event markers with labels
                    ctx.setLineDash([]);
                    ctx.lineWidth = 1.5;
                    ctx.font = 'bold 10px sans-serif';
                    for (const m of eventMarkersRef.current) {
                        const ex = u.valToPos(m.timeSec, 'x', true);
                        if (ex < left || ex > left + bw) continue;
                        ctx.strokeStyle = m.color;
                        ctx.fillStyle = m.color;
                        ctx.beginPath();
                        ctx.moveTo(ex, top);
                        ctx.lineTo(ex, top + bh);
                        ctx.stroke();
                        ctx.fillText(m.event, ex + 3, top + 12);
                    }

                    ctx.restore();
                }],
            },
        };

        const tooltipPlugin: uPlot.Plugin = {
            hooks: {
                init: [(u) => {
                    u.root.style.position = 'relative';
                    u.root.appendChild(ttEl);
                }],
                setCursor: [(u) => {
                    const { idx, left: cx, top: cy } = u.cursor;
                    if (idx == null || cx == null || cy == null) { ttEl.style.display = 'none'; return; }

                    const xSec = (u.data[0] as number[])[idx] ?? 0;
                    const btA = (u.data[2] as (number | null)[])[idx];
                    const etA = (u.data[3] as (number | null)[])[idx];
                    const btT = (u.data[1] as (number | null)[])[idx];

                    const rows: { name: string; val: number; color: string }[] = [];
                    if (btA != null) rows.push({ name: 'Bean Temp', val: btA, color: colorPrimary });
                    if (etA != null) rows.push({ name: 'Env Temp', val: etA, color: '#2563eb' });
                    if (btT != null) rows.push({ name: 'Target BT', val: btT, color: 'rgba(23,23,23,0.4)' });
                    if (rows.length === 0) { ttEl.style.display = 'none'; return; }

                    ttEl.innerHTML = `
                        <div style="font-weight:500;color:${colorMuted};margin-bottom:6px;letter-spacing:0.14px">${fmtSec(xSec)}</div>
                        ${rows.map(r => `
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                                <div style="width:8px;height:8px;border-radius:2px;background:${r.color};flex-shrink:0"></div>
                                <span style="color:${colorSecondary}">${r.name}:</span>
                                <span style="font-weight:600;color:${colorPrimary}">${r.val.toFixed(1)}°C</span>
                            </div>`).join('')}
                    `;

                    const tw = ttEl.offsetWidth || 140;
                    const offsetX = cx + 12 + tw > u.width ? cx - tw - 12 : cx + 12;
                    ttEl.style.display = 'block';
                    ttEl.style.left = `${offsetX}px`;
                    ttEl.style.top = `${Math.max(0, cy - 20)}px`;
                }],
            },
        };

        const opts: uPlot.Options = {
            width: el.offsetWidth,
            height,
            padding: [4, 12, 0, 0],
            cursor: { focus: { prox: 16 }, drag: { x: false, y: false } },
            legend: { show: false },
            axes: [
                {
                    stroke: colorMuted,
                    grid: { stroke: 'rgba(0,0,0,0.1)', width: 1 },
                    ticks: { show: false },
                    border: { show: false },
                    font: `11px monospace`,
                    size: 24,
                    incrs: [15, 30, 60, 120, 180, 300],
                    values: (_, vals) => vals.map(v => fmtSec(v)),
                },
                {
                    stroke: colorMuted,
                    grid: { stroke: 'rgba(0,0,0,0.1)', width: 1 },
                    ticks: { show: false },
                    border: { show: false },
                    font: `11px monospace`,
                    size: 40,
                    incrs: [10, 20, 25, 50],
                    values: (_, vals) => vals.map(v => `${v}°C`),
                },
            ],
            scales: {
                x: { time: false },
                y: { range: [130, 240] },
            },
            series: [
                {},
                // btTarget — dashed, faded
                { stroke: 'rgba(23,23,23,0.25)', width: 1.5, dash: [5, 4], points: { show: false } },
                // btActual
                { stroke: colorPrimary, width: 2.5, points: { show: false } },
                // etActual — dashed, blue, 70% opacity
                { stroke: 'rgba(37,99,235,0.7)', width: 1.5, dash: [5, 3], points: { show: false } },
            ],
            plugins: [refLinePlugin, tooltipPlugin],
            hooks: {
                setCursor: [(u) => { onCursorIdxRef.current?.(u.cursor.idx ?? null); }],
            },
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current = new uPlot(opts, [xs, btTarget, btActual, etActual] as any, el);

        const obs = new ResizeObserver(() => {
            if (plotRef.current && el) {
                plotRef.current.setSize({ width: el.offsetWidth, height: plotRef.current.height });
            }
        });
        obs.observe(el);

        return () => { obs.disconnect(); plotRef.current?.destroy(); plotRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update series data when zoom or live data changes
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current?.setData([xs, btTarget, btActual, etActual] as any);
    }, [xs, btTarget, btActual, etActual]);

    // Redraw reference lines when time or event markers change (no path rebuild needed)
    useEffect(() => {
        plotRef.current?.redraw(false);
    }, [currentTimeSec, eventMarkers]);

    // Sync explicit height changes (normal ↔ fullscreen)
    useEffect(() => {
        if (plotRef.current) {
            plotRef.current.setSize({ width: containerRef.current?.offsetWidth ?? plotRef.current.width, height });
        }
    }, [height]);

    return <div ref={containerRef} className="w-full" />;
};
