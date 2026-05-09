import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import type { TurningPoint } from '@shared/lib/turningPoints';
import type { TemperatureUnit } from '@shared/store/roastSettings';

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
    rorActual: (number | null)[];
    currentTimeSec: number;
    eventMarkers: RoastEventMarker[];
    turningPoints?: TurningPoint[];
    temperatureUnit?: TemperatureUnit;
    height: number;
    onCursorIdx?: (idx: number | null) => void;
    showET?: boolean;
    showTargetCurve?: boolean;
    showRoR?: boolean;
}

const PHASE_SECS = [180, 300, 630];
const ROR_Y_MIN = -5;
const ROR_Y_MAX = 20;

const fmtSec = (v: number) => {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

const TP_COLOR = '#16a34a';
const MARKER_LABEL_FONT = 'bold 27px sans-serif';
const MARKER_LABEL_Y_OFFSET = 28;

export const RoastTempChart = ({
    xs,
    btTarget,
    btActual,
    etActual,
    rorActual,
    currentTimeSec,
    eventMarkers,
    turningPoints = [],
    temperatureUnit = 'C',
    height,
    onCursorIdx,
    showET = true,
    showTargetCurve = true,
    showRoR = true,
}: Props) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    // Mutable refs so plugin hooks always read latest values without recreating uPlot
    const currentTimeRef = useRef(currentTimeSec);
    const eventMarkersRef = useRef(eventMarkers);
    const turningPointsRef = useRef(turningPoints);
    const onCursorIdxRef = useRef(onCursorIdx);
    const temperatureUnitRef = useRef(temperatureUnit);
    currentTimeRef.current = currentTimeSec;
    eventMarkersRef.current = eventMarkers;
    turningPointsRef.current = turningPoints;
    onCursorIdxRef.current = onCursorIdx;
    temperatureUnitRef.current = temperatureUnit;

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
                    ctx.font = MARKER_LABEL_FONT;
                    for (const m of eventMarkersRef.current) {
                        const ex = u.valToPos(m.timeSec, 'x', true);
                        if (ex < left || ex > left + bw) continue;
                        ctx.strokeStyle = m.color;
                        ctx.fillStyle = m.color;
                        ctx.beginPath();
                        ctx.moveTo(ex, top);
                        ctx.lineTo(ex, top + bh);
                        ctx.stroke();
                        ctx.fillText(m.event, ex + 3, top + MARKER_LABEL_Y_OFFSET);
                    }

                    // TP vertical line (same style as event markers)
                    ctx.font = MARKER_LABEL_FONT;
                    for (const tp of turningPointsRef.current) {
                        const tx = u.valToPos(tp.timeSec, 'x', true);
                        if (tx < left || tx > left + bw) continue;
                        ctx.strokeStyle = TP_COLOR;
                        ctx.fillStyle = TP_COLOR;
                        ctx.beginPath();
                        ctx.moveTo(tx, top);
                        ctx.lineTo(tx, top + bh);
                        ctx.stroke();
                        ctx.fillText('TP', tx + 3, top + MARKER_LABEL_Y_OFFSET);
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
                    const ror = (u.data[4] as (number | null)[])[idx];

                    const rows: { name: string; val: string; color: string }[] = [];
                    if (btA != null) rows.push({ name: 'Bean Temp', val: `${btA.toFixed(1)}°${temperatureUnitRef.current}`, color: colorPrimary });
                    if (etA != null) rows.push({ name: 'Env Temp', val: `${etA.toFixed(1)}°${temperatureUnitRef.current}`, color: '#2563eb' });
                    if (btT != null) rows.push({ name: 'Target BT', val: `${btT.toFixed(1)}°${temperatureUnitRef.current}`, color: 'rgba(23,23,23,0.4)' });
                    if (ror != null && u.series[4]?.show) rows.push({ name: 'BT RoR', val: `${ror.toFixed(1)}°/min`, color: '#d97706' });
                    if (rows.length === 0) { ttEl.style.display = 'none'; return; }

                    ttEl.innerHTML = `
                        <div style="font-weight:500;color:${colorMuted};margin-bottom:6px;letter-spacing:0.14px">${fmtSec(xSec)}</div>
                        ${rows.map(r => `
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                                <div style="width:8px;height:8px;border-radius:2px;background:${r.color};flex-shrink:0"></div>
                                <span style="color:${colorSecondary}">${r.name}:</span>
                                <span style="font-weight:600;color:${colorPrimary}">${r.val}</span>
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
                // Left Y-axis: temperature
                {
                    stroke: colorMuted,
                    grid: { stroke: 'rgba(0,0,0,0.1)', width: 1 },
                    ticks: { show: false },
                    border: { show: false },
                    font: `11px monospace`,
                    size: 40,
                    incrs: [10, 20, 25, 50],
                    values: (_, vals) => vals.map(v => `${v}°${temperatureUnit}`),
                },
                // Right Y-axis: RoR
                {
                    scale: 'ror',
                    side: 1,
                    stroke: '#d97706',
                    grid: { show: false },
                    ticks: { show: false },
                    border: { show: false },
                    font: `10px monospace`,
                    size: 36,
                    splits: [ROR_Y_MIN, 0, ROR_Y_MAX],
                    values: (_, vals) => vals.map(v => `${v}`),
                },
            ],
            scales: {
                x: { time: false },
                y: { range: temperatureUnit === 'F' ? [266, 464] : [130, 240] },
                ror: { range: [ROR_Y_MIN, ROR_Y_MAX] },
            },
            series: [
                {},
                // btTarget — dashed, faded
                { stroke: 'rgba(23,23,23,0.25)', width: 1.5, dash: [5, 4], points: { show: false } },
                // btActual
                { stroke: colorPrimary, width: 2.5, points: { show: false } },
                // etActual — dashed, blue, 70% opacity
                { stroke: 'rgba(37,99,235,0.7)', width: 1.5, dash: [5, 3], points: { show: false } },
                // rorActual — amber, right axis
                { scale: 'ror', stroke: '#d97706', width: 1.5, dash: [4, 3], points: { show: false }, show: showRoR },
            ],
            plugins: [refLinePlugin, tooltipPlugin],
            hooks: {
                setCursor: [(u) => { onCursorIdxRef.current?.(u.cursor.idx ?? null); }],
            },
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current = new uPlot(opts, [xs, btTarget, btActual, etActual, rorActual] as any, el);

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
        plotRef.current?.setData([xs, btTarget, btActual, etActual, rorActual] as any);
    }, [xs, btTarget, btActual, etActual, rorActual]);

    // Redraw reference lines when time, event markers, or turning points change (no path rebuild needed)
    useEffect(() => {
        plotRef.current?.redraw(false);
    }, [currentTimeSec, eventMarkers, turningPoints]);

    // Sync explicit height changes (normal ↔ fullscreen)
    useEffect(() => {
        if (plotRef.current) {
            plotRef.current.setSize({ width: containerRef.current?.offsetWidth ?? plotRef.current.width, height });
        }
    }, [height]);

    // Series visibility toggles
    useEffect(() => {
        plotRef.current?.setSeries(1, { show: showTargetCurve });
    }, [showTargetCurve]);

    useEffect(() => {
        plotRef.current?.setSeries(3, { show: showET });
    }, [showET]);

    useEffect(() => {
        plotRef.current?.setSeries(4, { show: showRoR });
    }, [showRoR]);

    return <div ref={containerRef} className="w-full" />;
};
