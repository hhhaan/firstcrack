import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import {
    CHART_COLORS,
    PHASE_SECS,
    ROR_Y_MIN,
    ROR_Y_MAX,
    MARKER_LABEL_FONT_CSS_PX,
    MARKER_LABEL_Y_OFFSET_CSS_PX,
} from '@features/active-roast/lib/chart-config';
import type { TurningPoint, TemperatureUnit } from '@features/active-roast';
import { computeHitThreshSec, useMarkerDrag } from './useMarkerDrag';

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
    onEventMarkerDrag?: (event: string, newTimeSec: number) => void;
    showET?: boolean;
    showTargetCurve?: boolean;
    showRoR?: boolean;
}

const fmtSec = (v: number) => {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

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
    onEventMarkerDrag,
    showET = true,
    showTargetCurve = true,
    showRoR = true,
}: Props) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    const currentTimeRef = useRef(currentTimeSec);
    const eventMarkersRef = useRef(eventMarkers);
    const turningPointsRef = useRef(turningPoints);
    const onCursorIdxRef = useRef(onCursorIdx);
    const temperatureUnitRef = useRef(temperatureUnit);
    const onEventMarkerDragRef = useRef(onEventMarkerDrag);
    currentTimeRef.current = currentTimeSec;
    eventMarkersRef.current = eventMarkers;
    turningPointsRef.current = turningPoints;
    onCursorIdxRef.current = onCursorIdx;
    temperatureUnitRef.current = temperatureUnit;
    onEventMarkerDragRef.current = onEventMarkerDrag;

    const { isDraggingRef, isNearMarkerRef, hoveredMarkerRef, setupDrag } = useMarkerDrag(
        eventMarkersRef,
        onEventMarkerDragRef,
    );

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const cs = getComputedStyle(document.documentElement);
        const colorPrimary = cs.getPropertyValue('--color-primary').trim() || '#171717';
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';
        const colorSecondary = cs.getPropertyValue('--color-secondary').trim() || '#6b7280';

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

        const refLinePlugin: uPlot.Plugin = {
            hooks: {
                draw: [
                    (u) => {
                        const { ctx } = u;
                        const { top, height: bh, left, width: bw } = u.bbox;
                        ctx.save();

                        ctx.strokeStyle = CHART_COLORS.phaseLines;
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

                        const ct = currentTimeRef.current;
                        if (ct > 0) {
                            const cx = u.valToPos(ct, 'x', true);
                            if (cx >= left && cx <= left + bw) {
                                ctx.strokeStyle = CHART_COLORS.currentTimeLine;
                                ctx.setLineDash([4, 3]);
                                ctx.lineWidth = 1.5;
                                ctx.beginPath();
                                ctx.moveTo(cx, top);
                                ctx.lineTo(cx, top + bh);
                                ctx.stroke();
                            }
                        }

                        const dpr = devicePixelRatio;
                        ctx.setLineDash([]);
                        ctx.lineWidth = 4;
                        ctx.font = `bold ${Math.round(MARKER_LABEL_FONT_CSS_PX * dpr)}px monospace`;
                        const labelY = top + MARKER_LABEL_Y_OFFSET_CSS_PX * dpr;
                        const hovered = hoveredMarkerRef.current;
                        const hasHover = hovered != null && !isDraggingRef.current;
                        for (const m of eventMarkersRef.current) {
                            const ex = u.valToPos(m.timeSec, 'x', true);
                            if (ex < left || ex > left + bw) continue;
                            ctx.globalAlpha = hasHover && m.event !== hovered ? 0.2 : 1;
                            ctx.strokeStyle = m.color;
                            ctx.fillStyle = m.color;
                            ctx.beginPath();
                            ctx.moveTo(ex, top);
                            ctx.lineTo(ex, top + bh);
                            ctx.stroke();
                            ctx.fillText(m.event, ex + 3, labelY);
                        }
                        ctx.globalAlpha = 1;

                        for (const tp of turningPointsRef.current) {
                            const tx = u.valToPos(tp.timeSec, 'x', true);
                            if (tx < left || tx > left + bw) continue;
                            ctx.strokeStyle = CHART_COLORS.tp;
                            ctx.fillStyle = CHART_COLORS.tp;
                            ctx.beginPath();
                            ctx.moveTo(tx, top);
                            ctx.lineTo(tx, top + bh);
                            ctx.stroke();
                            ctx.fillText('TP', tx + 3, labelY);
                        }

                        ctx.restore();
                    },
                ],
            },
        };

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
                        if (isDraggingRef.current || isNearMarkerRef.current) {
                            ttEl.style.display = 'none';
                            return;
                        }
                        const { idx, left: cx, top: cy } = u.cursor;
                        if (idx == null || cx == null || cy == null) {
                            ttEl.style.display = 'none';
                            return;
                        }

                        const xSec = (u.data[0] as number[])[idx] ?? 0;
                        const btA = (u.data[2] as (number | null)[])[idx];
                        const etA = (u.data[3] as (number | null)[])[idx];
                        const btT = (u.data[1] as (number | null)[])[idx];
                        const ror = (u.data[4] as (number | null)[])[idx];

                        const rows: { name: string; val: string; color: string }[] = [];
                        if (btA != null)
                            rows.push({
                                name: 'Bean Temp',
                                val: `${btA.toFixed(1)}°${temperatureUnitRef.current}`,
                                color: CHART_COLORS.btActual,
                            });
                        if (etA != null)
                            rows.push({
                                name: 'Env Temp',
                                val: `${etA.toFixed(1)}°${temperatureUnitRef.current}`,
                                color: '#2563eb',
                            });
                        if (btT != null)
                            rows.push({
                                name: 'Target BT',
                                val: `${btT.toFixed(1)}°${temperatureUnitRef.current}`,
                                color: CHART_COLORS.btTargetTooltip,
                            });
                        if (ror != null && u.series[4]?.show)
                            rows.push({ name: 'BT RoR', val: `${ror.toFixed(1)}°/min`, color: '#FFC107' });
                        if (rows.length === 0) {
                            ttEl.style.display = 'none';
                            return;
                        }

                        ttEl.innerHTML = `
                        <div style="font-weight:500;color:${colorMuted};margin-bottom:6px;letter-spacing:0.14px">${fmtSec(xSec)}</div>
                        ${rows
                            .map(
                                (r) => `
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                                <div style="width:8px;height:8px;border-radius:2px;background:${r.color};flex-shrink:0"></div>
                                <span style="color:${colorSecondary}">${r.name}:</span>
                                <span style="font-weight:600;color:${colorPrimary}">${r.val}</span>
                            </div>`,
                            )
                            .join('')}
                    `;

                        const tw = ttEl.offsetWidth || 140;
                        const offsetX = cx + 12 + tw > u.width ? cx - tw - 12 : cx + 12;
                        ttEl.style.display = 'block';
                        ttEl.style.left = `${offsetX}px`;
                        ttEl.style.top = `${Math.max(0, cy - 20)}px`;
                    },
                ],
            },
        };

        const opts: uPlot.Options = {
            width: el.offsetWidth,
            height,
            padding: [12, 12, 0, 0],
            cursor: { focus: { prox: 16 }, drag: { x: false, y: false } },
            legend: { show: false },
            axes: [
                {
                    stroke: colorMuted,
                    grid: { stroke: 'rgba(0,0,0,0.1)', width: 1 },
                    ticks: { show: false },
                    border: { show: false },
                    font: `11px monospace`,
                    size: 28,
                    incrs: [60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720],
                    values: (_, vals) => vals.map((v) => fmtSec(v)),
                },
                {
                    stroke: colorMuted,
                    grid: { stroke: 'rgba(0,0,0,0.1)', width: 1 },
                    ticks: { show: false },
                    border: { show: false },
                    font: `11px monospace`,
                    size: 38,
                    incrs: [10, 20, 25, 50],
                    values: (_, vals) => vals.map((v) => (v === 130 ? '' : `${v}°${temperatureUnit}`)),
                },
                {
                    scale: 'ror',
                    side: 1,
                    stroke: CHART_COLORS.rorActual,
                    grid: { show: false },
                    ticks: { show: false },
                    border: { show: false },
                    font: `10px monospace`,
                    size: 25,
                    splits: [0, 10, 20],
                    values: (_, vals) => vals.map((v) => `${v}`),
                },
            ],
            scales: {
                x: { time: false },
                y: { range: temperatureUnit === 'F' ? [266, 464] : [130, 240] },
                ror: { range: [ROR_Y_MIN, ROR_Y_MAX] },
            },
            series: [
                {},
                { stroke: CHART_COLORS.btTarget, width: 2.0, dash: [6, 4], points: { show: false } },
                { stroke: CHART_COLORS.btActual, width: 3.0, points: { show: false } },
                { stroke: CHART_COLORS.etActual, width: 3.0, points: { show: false } },
                {
                    scale: 'ror',
                    stroke: CHART_COLORS.rorActual,
                    width: 3.0,
                    points: { show: false },
                    show: showRoR,
                },
            ],
            plugins: [refLinePlugin, tooltipPlugin],
            hooks: {
                setCursor: [
                    (u) => {
                        onCursorIdxRef.current?.(u.cursor.idx ?? null);

                        if (isDraggingRef.current) return;
                        const cx = u.cursor.left;
                        if (cx == null) return;
                        const cursorTime = u.posToVal(cx, 'x');
                        const thresh = computeHitThreshSec(u);
                        const hovered =
                            eventMarkersRef.current.find((m) => Math.abs(cursorTime - m.timeSec) <= thresh) ?? null;
                        const nextHovered = hovered?.event ?? null;

                        isNearMarkerRef.current = nextHovered != null;
                        (u.over as HTMLElement).style.cursor = nextHovered != null ? 'pointer' : '';

                        if (nextHovered !== hoveredMarkerRef.current) {
                            hoveredMarkerRef.current = nextHovered;
                            u.redraw(false);
                        }
                    },
                ],
            },
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current = new uPlot(opts, [xs, btTarget, btActual, etActual, rorActual] as any, el);

        const teardownDrag = setupDrag(plotRef.current);

        const obs = new ResizeObserver(() => {
            if (plotRef.current && el) {
                const newW = el.offsetWidth;
                if (newW !== plotRef.current.width) {
                    plotRef.current.setSize({ width: newW, height: plotRef.current.height });
                }
            }
        });
        obs.observe(el);

        return () => {
            teardownDrag();
            obs.disconnect();
            plotRef.current?.destroy();
            plotRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plotRef.current?.setData([xs, btTarget, btActual, etActual, rorActual] as any);
    }, [xs, btTarget, btActual, etActual, rorActual]);

    useEffect(() => {
        plotRef.current?.redraw(false);
    }, [currentTimeSec, eventMarkers, turningPoints]);

    useEffect(() => {
        if (plotRef.current) {
            plotRef.current.setSize({ width: containerRef.current?.offsetWidth ?? plotRef.current.width, height });
        }
    }, [height]);

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
