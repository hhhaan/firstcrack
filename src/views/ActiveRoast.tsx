import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { Play, Square, Maximize2, Minimize2, Plug, Coffee } from 'lucide-react';
import { EndRoastModal } from '@widgets/active-roast/end-roast-modal/ui/EndRoastModal';
import {
    RoastSummaryModal,
    type RoastSummaryData,
} from '@widgets/active-roast/roast-summary-modal/ui/RoastSummaryModal';
import { RoastTempChart, type RoastEventMarker } from '@widgets/active-roast/ui/RoastTempChart';
import { EVENT_MARKER_COLORS } from '@features/active-roast/lib/chart-config';

import {
    roastProfiles,
    generateProfileCurve,
    interpolateProfileBT,
    DEFAULT_PROFILE_KEY,
} from '@shared/data/roast-profiles';
import type { LogEntry } from '@shared/types/roast';
import { isEditableTarget } from '@shared/lib/dom';
import { sidecar } from '@shared/lib/sidecar';
import {
    useRoastSettings,
    detectTurningPoints,
    toDisplayTemp,
    toDisplayRoR,
    formatTemp,
    type TurningPoint,
} from '@features/active-roast';

import { RoastHeader, LiveReadings, MachineControls, EventButtons, RoastLog } from '@widgets/active-roast';
import { ChartLegend } from '@widgets/active-roast/ui/ChartLegend';
import useRoastingStore from '@features/active-roast/model/status';

const TOGGLEABLE_LOG_EVENTS = new Set(['Yellow', 'FC Start', 'FC End', 'Drop']);

// Auto-charge detection: BT drops ≥5°C over 5 readings
const AUTO_CHARGE_DROP_C = 5;
const AUTO_CHARGE_WINDOW = 5;

// Auto-drop detection: BT drops ≥8°C over 5 readings, only after 3 min into roast
const AUTO_DROP_DROP_C = 8;
const AUTO_DROP_WINDOW = 5;
const AUTO_DROP_MIN_ELAPSED_S = 180;

export const ActiveRoast = ({
    isActive,
    onOpenRoastSettings,
}: {
    isActive: boolean;
    onOpenRoastSettings?: () => void;
}) => {
    const roastSettings = useRoastSettings();
    const [targetProfileId, setTargetProfileId] = useState<number | null>(() => {
        const stored = localStorage.getItem(DEFAULT_PROFILE_KEY);
        return stored ? Number(stored) : (roastProfiles[0]?.id ?? null);
    });
    const [elapsed, setElapsed] = useState(0);
    const [isRunning, setIsRunning] = useState(false);
    const isRunningRef = useRef(isRunning);
    isRunningRef.current = isRunning;

    // Phase machine: idle → preheating → standby → roasting → ended
    const [phase, setPhase] = useState<'idle' | 'preheating' | 'standby' | 'roasting' | 'ended'>('idle');
    const phaseRef = useRef(phase);
    phaseRef.current = phase;

    const charged = phase === 'roasting' || phase === 'ended';
    const roastEnded = phase === 'ended';

    // Sync phase to global store so Dashboard indicator works
    const storeStartCharge = useRoastingStore((s) => s.startCharge);
    const storeEndRoast = useRoastingStore((s) => s.endRoast);
    useEffect(() => {
        if (phase === 'roasting') storeStartCharge();
        else if (phase === 'ended') storeEndRoast();
    }, [phase, storeStartCharge, storeEndRoast]);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showEndRoastModal, setShowEndRoastModal] = useState(false);
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [summaryData, setSummaryData] = useState<RoastSummaryData | null>(null);
    const [roastNotes, setRoastNotes] = useState('');
    const [pressedButtons, setPressedButtons] = useState<Set<string>>(new Set());
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [liveData, setLiveData] = useState<{
        bt: number | null;
        et: number | null;
        ror: number;
        ror_et: number;
        heater: number;
        fan: number;
        drum: number;
    } | null>(null);
    const [sidecarConnected, setSidecarConnected] = useState(false);
    const [machineCapabilities, setMachineCapabilities] = useState<string[]>([]);
    const [livePoints, setLivePoints] = useState<
        { time: number; label: string; bt: number; et: number | null; ror: number | null; ror_et: number | null }[]
    >([]);
    const [confirmedTP, setConfirmedTP] = useState<TurningPoint | null>(null);
    const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);
    const [hoveredChartIndex, setHoveredChartIndex] = useState<number | null>(null);
    const [mainChartHeight, setMainChartHeight] = useState(350);
    const [isChartDragging, setIsChartDragging] = useState(false);
    // const chartWrapperRef = useRef<HTMLDivElement>(null); // TODO: 높이 계산 방식 재검토

    // Rolling BT window for auto-charge detection (standby phase)
    const btWindowRef = useRef<number[]>([]);
    const autoChargedRef = useRef(false);

    // Rolling BT window for auto-drop detection (roasting phase)
    const dropWindowRef = useRef<number[]>([]);
    const autoDroppedRef = useRef(false);

    const elapsedRef = useRef(0);
    const chargedRef = useRef(false);
    const roastStartTimeRef = useRef(0);
    const tpTimeSecRef = useRef<number | null>(null);
    const chartAreaRef = useRef<HTMLDivElement>(null);
    const chartDragRef = useRef<{
        pointerId: number;
        startX: number;
        startRange: { start: number; end: number };
    } | null>(null);

    useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
    useEffect(() => { chargedRef.current = charged; }, [charged]);

    const toggleFullscreen = () => setIsFullscreen((prev) => !prev);

    // TODO: 아래 접근 방식으로 다시 돌아옴 — chartWrapperRef(flex-1 min-h-0) 방식은
    // uPlot이 height를 JS로 강제 설정해서 div가 flex-1 할당 높이를 초과할 수 있음 → 루프
    useEffect(() => {
        const el = chartAreaRef.current;
        if (!el) return;
        const obs = new ResizeObserver(() => {
            const h = el.offsetHeight;
            // ChartLegend is absolute (0px flow) + phase pills(~22px) + mb-3(12px) ≈ 36px
            setMainChartHeight(Math.max(180, h - 36));
        });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    useEffect(() => {
        if (!isRunning) return;
        const interval = setInterval(() => {
            setElapsed((e) => e + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [isRunning]);

    useEffect(() => {
        if (!('__TAURI_INTERNALS__' in window)) return;
        const win = getCurrentWindow();
        let unlisten: (() => void) | undefined;
        let active = true;
        win.onCloseRequested(async (e) => {
            if (!isRunningRef.current) return;
            e.preventDefault();
            const ok = await ask('로스팅이 진행 중입니다. 정말 종료하시겠습니까?', {
                title: '로스팅 진행 중',
                kind: 'warning',
                okLabel: '종료',
                cancelLabel: '취소',
            });
            if (ok) {
                unlisten?.();
                win.close();
            }
        }).then((fn) => {
            active ? (unlisten = fn) : fn();
        });
        return () => {
            active = false;
            unlisten?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Initial connection check
    useEffect(() => {
        sidecar
            .getStatus()
            .then((s) => {
                setSidecarConnected(s.connected);
                if (s.connected && phaseRef.current === 'idle') {
                    setPhase('preheating');
                    setMachineCapabilities(s.capabilities ?? []);
                }
            })
            .catch(() => setSidecarConnected(false));
    }, []);

    // Sidecar polling — active during preheating, standby, and roasting
    useEffect(() => {
        if (phase === 'idle' || phase === 'ended') return;

        const poll = async () => {
            try {
                const data = await sidecar.getTemperatures();
                setLiveData(data);
                setSidecarConnected(true);
                const bt = data.bt;

                // Auto-charge detection in standby phase
                if (phaseRef.current === 'standby' && bt != null && !autoChargedRef.current) {
                    btWindowRef.current = [...btWindowRef.current.slice(-(AUTO_CHARGE_WINDOW - 1)), bt];
                    if (btWindowRef.current.length >= AUTO_CHARGE_WINDOW) {
                        const first = btWindowRef.current[0];
                        const last = btWindowRef.current[btWindowRef.current.length - 1];
                        if (first - last >= AUTO_CHARGE_DROP_C) {
                            autoChargedRef.current = true;
                            triggerCharge(bt);
                        }
                    }
                }

                // Record live points + auto-drop detection during roasting
                if (phaseRef.current === 'roasting' && bt != null && roastStartTimeRef.current !== 0) {
                    const t = (Date.now() - roastStartTimeRef.current) / 1000;
                    setLivePoints((prev) => {
                        if (prev.length > 0 && t - prev[prev.length - 1].time < 0.4) return prev;
                        const min = Math.floor(t / 60);
                        const sec = Math.floor(t % 60);
                        const tpConfirmed = tpTimeSecRef.current != null;
                        return [
                            ...prev,
                            {
                                time: t,
                                label: `${min}:${String(sec).padStart(2, '0')}`,
                                bt,
                                et: data.et ?? null,
                                ror: tpConfirmed ? data.ror : null,
                                ror_et: tpConfirmed ? (data.ror_et ?? null) : null,
                            },
                        ];
                    });

                    // Auto-drop detection — only after minimum elapsed time
                    if (!autoDroppedRef.current && elapsedRef.current >= AUTO_DROP_MIN_ELAPSED_S) {
                        dropWindowRef.current = [...dropWindowRef.current.slice(-(AUTO_DROP_WINDOW - 1)), bt];
                        if (dropWindowRef.current.length >= AUTO_DROP_WINDOW) {
                            const first = dropWindowRef.current[0];
                            const last = dropWindowRef.current[dropWindowRef.current.length - 1];
                            if (first - last >= AUTO_DROP_DROP_C) {
                                autoDroppedRef.current = true;
                                setLogEntries((prev) => {
                                    if (prev.some((e) => e.event === 'Drop')) return prev;
                                    const min2 = Math.floor(elapsedRef.current / 60);
                                    const sec2 = elapsedRef.current % 60;
                                    return [...prev, {
                                        time: `${min2}:${String(sec2).padStart(2, '0')}`,
                                        event: 'Drop',
                                        temp: formatTemp(bt, unit),
                                        note: 'Bean drop detected',
                                    }];
                                });
                                setShowEndRoastModal(true);
                            }
                        }
                    }
                }
            } catch {
                setSidecarConnected(false);
            }
        };

        poll();
        const id = setInterval(poll, roastSettings.pollIntervalMs);
        return () => clearInterval(id);
    }, [phase, roastSettings.pollIntervalMs]);

    useEffect(() => {
        if (!showEndRoastModal) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isActive) return;
            if (event.key === 'Escape') setShowEndRoastModal(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, showEndRoastModal]);

    const unit = roastSettings.temperatureUnit;

    const rawBT = liveData?.bt ?? null;
    const rawET = liveData?.et ?? null;
    const displayBT = rawBT != null ? toDisplayTemp(rawBT, unit) : null;

    const targetCurve = useMemo(() => {
        if (!targetProfileId) return null;
        const profile = roastProfiles.find((p) => p.id === targetProfileId);
        if (!profile) return null;
        return generateProfileCurve(profile.dropVal, profile.durationSec);
    }, [targetProfileId]);

    const CHART_TOTAL_SECS = 780;

    // Real recorded data + null sentinels at t=0 and t=CHART_TOTAL_SECS so the
    // x-axis always spans the full roasting range regardless of recording progress.
    // Only actual sensor readings have non-null btActual/etActual values.
    const chartData = useMemo(() => {
        const sentinel = (t: number) => ({
            time: t,
            btActual: null as number | null,
            etActual: null as number | null,
            rorActual: null as number | null,
            etRorActual: null as number | null,
            btTarget: targetCurve ? interpolateProfileBT(targetCurve, t) : null,
        });

        const live = livePoints.map((p) => ({
            time: p.time,
            btActual: p.bt,
            etActual: p.et,
            rorActual: p.ror,
            etRorActual: p.ror_et,
            btTarget: targetCurve ? interpolateProfileBT(targetCurve, p.time) : null,
        }));

        const needsStart = live.length === 0 || live[0].time > 0.5;
        const needsEnd = live.length === 0 || live[live.length - 1].time < CHART_TOTAL_SECS - 1;
        return [
            ...(needsStart ? [sentinel(0)] : []),
            ...live,
            ...(needsEnd ? [sentinel(CHART_TOTAL_SECS)] : []),
        ];
    }, [livePoints, targetCurve]);

    const MAX_TIME = chartData.length > 0 ? chartData[chartData.length - 1].time : CHART_TOTAL_SECS;
    const MIN_VISIBLE_SECS = 60;
    const effectiveZoomRange = zoomRange
        ? { start: Math.max(0, zoomRange.start), end: Math.min(MAX_TIME, zoomRange.end) }
        : null;
    const visibleChartData = effectiveZoomRange
        ? chartData.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
        : chartData;

    const elapsedMin = Math.floor(elapsed / 60);
    const elapsedSec = elapsed % 60;
    const timeStr = `${elapsedMin}:${String(elapsedSec).padStart(2, '0')}`;

    const displayRoR =
        tpTimeSecRef.current == null
            ? '—'
            : toDisplayRoR(liveData?.ror ?? 0, unit).toFixed(1);

    // Phase label derived from event markers
    const fcStartEntry = logEntries.find((e) => e.event === 'FC Start');
    const yellowEntry = logEntries.find((e) => e.event === 'Yellow');
    const parseTimeSec = (t: string) => {
        const [m, s] = t.split(':').map(Number);
        return m * 60 + s;
    };
    const roastPhaseName = (() => {
        if (!charged) return '—';
        if (fcStartEntry && elapsed >= parseTimeSec(fcStartEntry.time)) return 'Development';
        if (yellowEntry && elapsed >= parseTimeSec(yellowEntry.time)) return 'Maillard';
        return 'Drying';
    })();
    const roastPhaseColor = roastPhaseName === 'Development' ? '#ea580c' : roastPhaseName === 'Maillard' ? '#b45309' : '#d97706';

    const eventMarkerColor = EVENT_MARKER_COLORS;

    const eventMarkers = useMemo(
        (): RoastEventMarker[] =>
            logEntries
                .filter((e) => eventMarkerColor[e.event] && e.event !== 'TP')
                .map((e) => {
                    const [min, sec] = e.time.split(':').map(Number);
                    const timeSec = Math.max(0, min * 60 + sec);
                    return { timeSec, event: e.event, color: eventMarkerColor[e.event] };
                }),
        [logEntries],
    );

    const turningPoints = useMemo(() => {
        if (confirmedTP) return [confirmedTP];
        const pts = detectTurningPoints(
            livePoints.map((p) => p.time),
            livePoints.map((p) => p.bt),
        );
        if (pts.length > 0) setConfirmedTP(pts[0]);
        return pts;
    }, [livePoints, confirmedTP]);

    useEffect(() => {
        if (!confirmedTP) return;
        const timeMin = Math.floor(confirmedTP.timeSec / 60);
        const timeSec = Math.floor(confirmedTP.timeSec % 60);
        const tpTimeStr = `${timeMin}:${String(timeSec).padStart(2, '0')}`;
        setLogEntries((prev) => {
            if (prev.some((e) => e.event === 'TP')) return prev;
            const newEntry = { time: tpTimeStr, event: 'TP', temp: formatTemp(confirmedTP.temp, unit), note: 'Turning Point detected' };
            return [...prev, newEntry].sort((a, b) => parseTimeSec(a.time) - parseTimeSec(b.time));
        });
    }, [confirmedTP, unit]);

    const tpTimeSec = turningPoints[0]?.timeSec ?? null;
    tpTimeSecRef.current = tpTimeSec;

    const conv = (v: number | null) => (v != null ? toDisplayTemp(v, unit) : null);
    // chartData always contains null sentinels at t=0 and t=CHART_TOTAL_SECS,
    // so these arrays are never empty and uPlot always gets the full x-range.
    const visibleXs = useMemo(() => visibleChartData.map((p) => p.time), [visibleChartData]);
    const visibleBtTarget = useMemo(() => visibleChartData.map((p) => conv(p.btTarget)), [visibleChartData, unit]);
    const visibleBtActual = useMemo(() => visibleChartData.map((p) => conv(p.btActual)), [visibleChartData, unit]);
    const visibleEtActual = useMemo(() => visibleChartData.map((p) => conv(p.etActual)), [visibleChartData, unit]);
    const visibleRorActual = useMemo(
        () => visibleChartData.map((p) => (p.rorActual != null ? toDisplayRoR(p.rorActual, unit) : null)),
        [visibleChartData, unit],
    );

    const flashButton = (label: string) => {
        setPressedButtons((prev) => new Set(prev).add(label));
        setTimeout(() => setPressedButtons((prev) => { const n = new Set(prev); n.delete(label); return n; }), 600);
    };

    const handleChartWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        if (MAX_TIME <= 0) return;
        event.preventDefault();
        const currentStart = effectiveZoomRange?.start ?? 0;
        const currentEnd = effectiveZoomRange?.end ?? MAX_TIME;
        const currentDuration = currentEnd - currentStart;
        if (event.deltaY < 0 && currentDuration <= MIN_VISIBLE_SECS) return;
        if (event.deltaY > 0 && currentStart === 0 && currentEnd === MAX_TIME) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const Y_AXIS_WIDTH = 36;
        const RIGHT_PAD = 12;
        const dataWidth = rect.width - Y_AXIS_WIDTH - RIGHT_PAD;
        const mouseX = event.clientX - rect.left - Y_AXIS_WIDTH;
        const pointerRatio = dataWidth > 0 ? Math.max(0, Math.min(1, mouseX / dataWidth)) : 0.5;
        const focusTime = currentStart + pointerRatio * currentDuration;
        const zoomFactor = event.deltaY < 0 ? 0.8 : 1.25;
        const nextDuration = Math.max(MIN_VISIBLE_SECS, Math.min(MAX_TIME, currentDuration * zoomFactor));
        if (nextDuration >= MAX_TIME) { setZoomRange(null); return; }
        let nextStart = focusTime - pointerRatio * nextDuration;
        let nextEnd = nextStart + nextDuration;
        if (nextStart < 0) { nextStart = 0; nextEnd = nextDuration; }
        if (nextEnd > MAX_TIME) { nextEnd = MAX_TIME; nextStart = MAX_TIME - nextDuration; }
        setZoomRange({ start: nextStart, end: nextEnd });
    };

    const zoomChart = (zoomFactor: number) => {
        if (MAX_TIME <= 0) return;
        const currentStart = effectiveZoomRange?.start ?? 0;
        const currentEnd = effectiveZoomRange?.end ?? MAX_TIME;
        const currentDuration = currentEnd - currentStart;
        const nextDuration = Math.max(MIN_VISIBLE_SECS, Math.min(MAX_TIME, currentDuration * zoomFactor));
        if (nextDuration >= MAX_TIME) { setZoomRange(null); return; }
        const focusTime = hoveredChartIndex != null
            ? (visibleChartData[hoveredChartIndex]?.time ?? (currentStart + currentEnd) / 2)
            : (currentStart + currentEnd) / 2;
        const ratio = currentDuration > 0 ? (focusTime - currentStart) / currentDuration : 0.5;
        let nextStart = focusTime - ratio * nextDuration;
        let nextEnd = nextStart + nextDuration;
        if (nextStart < 0) { nextStart = 0; nextEnd = nextDuration; }
        if (nextEnd > MAX_TIME) { nextEnd = MAX_TIME; nextStart = MAX_TIME - nextDuration; }
        setZoomRange({ start: nextStart, end: nextEnd });
    };

    const panChart = (direction: -1 | 1) => {
        if (!effectiveZoomRange) return;
        const duration = effectiveZoomRange.end - effectiveZoomRange.start;
        const step = Math.max(1, duration * 0.2);
        const nextStart = Math.max(0, Math.min(MAX_TIME - duration, effectiveZoomRange.start + step * direction));
        setZoomRange({ start: nextStart, end: nextStart + duration });
    };

    const getChartDataWidth = (rect: DOMRect) => Math.max(1, rect.width - 36 - 12);

    const handleChartPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!effectiveZoomRange || event.button !== 0) return;
        chartDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startRange: effectiveZoomRange };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        setIsChartDragging(true);
        event.preventDefault();
    };

    const handleChartPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = chartDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const duration = drag.startRange.end - drag.startRange.start;
        if (duration <= 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const dataWidth = getChartDataWidth(rect);
        const deltaPx = event.clientX - drag.startX;
        const deltaTime = -(deltaPx / dataWidth) * duration;
        const nextStart = Math.max(0, Math.min(MAX_TIME - duration, drag.startRange.start + deltaTime));
        setZoomRange({ start: nextStart, end: nextStart + duration });
        event.preventDefault();
    };

    const endChartDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = chartDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        chartDragRef.current = null;
        setIsChartDragging(false);
    };

    const handleChartKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomChart(0.8); return; }
        if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomChart(1.25); return; }
        if (event.key === '0') { event.preventDefault(); setZoomRange(null); return; }
        if (event.key === 'ArrowLeft') { event.preventDefault(); panChart(-1); return; }
        if (event.key === 'ArrowRight') { event.preventDefault(); panChart(1); }
    };

    const handleEventMarkerDrag = (event: string, newTimeSec: number) => {
        const newMin = Math.floor(newTimeSec / 60);
        const newSec = Math.floor(newTimeSec % 60);
        const newTimeStr = `${newMin}:${String(newSec).padStart(2, '0')}`;
        setLogEntries((prev) => prev.map((entry) => (entry.event === event ? { ...entry, time: newTimeStr } : entry)));
    };

    const markEvent = (event: string, note: string, buttonLabel?: string) => {
        const isRemoval = TOGGLEABLE_LOG_EVENTS.has(event) && logEntries.some((entry) => entry.event === event);
        setLogEntries((prev) => {
            if (TOGGLEABLE_LOG_EVENTS.has(event) && prev.some((entry) => entry.event === event)) {
                return prev.filter((entry) => entry.event !== event);
            }
            return [...prev, { time: timeStr, event, temp: formatTemp(rawBT, unit), note }];
        });
        if (!isRemoval && buttonLabel) flashButton(buttonLabel);
    };

    const handleDrop = () => markEvent('Drop', 'Coffee dropped', 'Drop');

    // Phase 1 → 2: Connect to machine
    const handleConnect = async () => {
        try {
            const status = await sidecar.getStatus();
            if (status.connected) {
                setSidecarConnected(true);
                setMachineCapabilities(status.capabilities ?? []);
                setPhase('preheating');
            } else {
                if ('__TAURI_INTERNALS__' in window) {
                    await message('머신이 연결되어 있지 않습니다. AddMachine에서 먼저 연결하세요.', {
                        title: '머신 연결 필요',
                        kind: 'warning',
                    });
                }
            }
        } catch {
            setSidecarConnected(false);
        }
    };

    // Phase 2 → standby: user confirms ready to roast
    const handleEnterStandby = () => {
        if (phase !== 'preheating') return;
        btWindowRef.current = [];
        autoChargedRef.current = false;
        setPhase('standby');
    };

    // Charge trigger (manual or auto)
    const triggerCharge = useCallback(
        (btAtCharge?: number | null) => {
            sidecar.startRoast().catch(() => {});
            roastStartTimeRef.current = Date.now();
            setPhase('roasting');
            setIsRunning(true);
            const temp = btAtCharge != null ? formatTemp(btAtCharge, unit) : formatTemp(rawBT, unit);
            setLogEntries([{ time: '0:00', event: 'Charge', temp, note: 'Bean drop detected' }]);
        },
        [unit, rawBT],
    );

    // Phase standby → roasting: manual charge button
    const handleManualCharge = async () => {
        if (charged) return;
        const status = await sidecar.getStatus().catch(() => null);
        if (!status?.connected) {
            setSidecarConnected(false);
            if ('__TAURI_INTERNALS__' in window) {
                await message('머신이 연결되어 있지 않습니다.', { title: '머신 연결 필요', kind: 'warning' });
            }
            return;
        }
        autoChargedRef.current = true; // prevent auto-charge racing
        triggerCharge(rawBT);
    };

    const resetActiveRoast = () => {
        roastStartTimeRef.current = 0;
        autoChargedRef.current = false;
        autoDroppedRef.current = false;
        btWindowRef.current = [];
        dropWindowRef.current = [];
        setElapsed(0);
        setIsRunning(false);
        setPhase(sidecarConnected ? 'preheating' : 'idle');
        setLogEntries([]);
        setLivePoints([]);
        setConfirmedTP(null);
        setZoomRange(null);
        setHoveredChartIndex(null);
        setPressedButtons(new Set());
    };

    const confirmEndRoast = () => {
        const completedLogEntries = [
            ...logEntries,
            { time: timeStr, event: 'End', temp: formatTemp(rawBT, unit), note: 'Roast complete' },
        ];
        setSummaryData({
            totalTime: timeStr,
            development: devTimeStr,
            finalBt: formatTemp(rawBT, unit),
            logEntries: completedLogEntries,
        });
        setPhase('ended');
        setIsRunning(false);
        setShowEndRoastModal(false);
        setRoastNotes('');
        setShowSummaryModal(true);
    };

    const handleEndRoastClick = () => {
        if (roastEnded || !charged) return;
        setShowEndRoastModal(true);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isActive) return;
            if (isEditableTarget(event.target) || showEndRoastModal || showSummaryModal) return;
            const shortcutModifier = event.metaKey || event.ctrlKey;

            if (event.key === 'Escape' && isFullscreen) { event.preventDefault(); setIsFullscreen(false); return; }
            if (!shortcutModifier && event.code === 'KeyF') { event.preventDefault(); toggleFullscreen(); return; }
            if (shortcutModifier && event.key === 'Enter') {
                event.preventDefault();
                if (phase === 'preheating') handleEnterStandby();
                else if (phase === 'standby') handleManualCharge();
                return;
            }
            if (!shortcutModifier) return;
            if (event.key === '1') { event.preventDefault(); markEvent('Yellow', 'Color change visible', 'Mark Yellow'); return; }
            if (event.key === '2') { event.preventDefault(); markEvent('FC Start', 'First crack started', 'Mark FC Start'); return; }
            if (event.key === '3') { event.preventDefault(); markEvent('FC End', 'First crack ended', 'Mark FC End'); return; }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, phase, displayBT, isFullscreen, roastEnded, showEndRoastModal, showSummaryModal, timeStr]);

    const devTimeStr = (() => {
        if (!fcStartEntry) return '—';
        const [m, s] = fcStartEntry.time.split(':').map(Number);
        const devSec = elapsed - (m * 60 + s);
        if (devSec <= 0) return '—';
        const pct = Math.round((devSec / elapsed) * 100);
        return `${Math.floor(devSec / 60)}:${String(devSec % 60).padStart(2, '0')} (${pct}%)`;
    })();

    const roastLogDisplayEntries = useMemo((): LogEntry[] => {
        const sorted = [...logEntries].sort((a, b) => parseTimeSec(a.time) - parseTimeSec(b.time));
        return [
            ...sorted,
            ...(!roastEnded && charged
                ? [{ time: timeStr, event: 'Now', temp: formatTemp(rawBT, unit), note: `${roastPhaseName} in progress`, current: true }]
                : []),
        ];
    }, [logEntries, roastEnded, charged, timeStr, rawBT, roastPhaseName]);

    // ─── Idle overlay ────────────────────────────────────────────────────────
    if (phase === 'idle') {
        return (
            <div className="px-10 py-8 max-w-275 mx-auto">
                <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
                    <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center shadow-(--shadow-inset)">
                        <Plug size={28} strokeWidth={1.5} color="var(--color-muted)" />
                    </div>
                    <div className="text-center">
                        <h2 className="text-xl font-semibold text-primary mb-2">머신이 연결되어 있지 않습니다</h2>
                        <p className="text-[13px] text-muted max-w-xs">
                            로스팅을 시작하려면 먼저 로스터기를 연결하세요.
                        </p>
                    </div>
                    <button
                        onClick={handleConnect}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-white text-sm font-medium cursor-pointer border-0 shadow-(--shadow-card)"
                    >
                        <Plug size={14} />
                        머신 연결
                    </button>
                </div>
            </div>
        );
    }

    // ─── Standby overlay (before charge) ────────────────────────────────────
    const standbyBanner = phase === 'standby' && (
        <div className="mb-5 flex items-center gap-3 px-5 py-3.5 rounded-lg bg-[rgba(220,252,231,0.6)] border border-[rgba(34,197,94,0.2)]">
            <Coffee size={16} color="#16a34a" />
            <div>
                <p className="text-[13px] font-medium text-[#16a34a]">생두를 투입해 주세요</p>
                <p className="text-xs text-[#15803d] opacity-80">온도 강하 감지 시 자동으로 로스팅이 시작됩니다 (또는 ⌘↵ 수동 시작)</p>
            </div>
        </div>
    );

    return (
        <div className="px-10 py-8 max-w-275 mx-auto">
            <RoastHeader
                roastEnded={roastEnded}
                charged={charged}
                sidecarConnected={sidecarConnected}
                timeStr={charged ? timeStr : phase === 'preheating' ? 'Ready' : 'Standby'}
                phase={roastPhaseName}
                targetProfileId={targetProfileId}
                onTargetProfileChange={setTargetProfileId}
                onOpenRoastSettings={onOpenRoastSettings}
            />

            <LiveReadings
                rawBT={rawBT}
                rawET={rawET}
                displayRoR={displayRoR}
                unit={unit}
                phase={roastPhaseName}
                phaseColor={roastPhaseColor}
                connected={sidecarConnected}
            />

            <MachineControls
                machineCapabilities={machineCapabilities}
                sidecarConnected={sidecarConnected}
                liveData={liveData}
            />

            {standbyBanner}

            {/* Temperature Chart */}
            <div
                className={`bg-main-bg flex flex-col mb-5 ${
                    isFullscreen
                        ? 'rounded-none fixed inset-0 z-9999 h-screen w-screen p-10'
                        : 'rounded-lg relative z-1 shadow-(--shadow-ring) px-6 pb-4 pt-6'
                }`}
            >
                <div className="mb-5">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">Temperature Curve</h2>
                        <button
                            onClick={toggleFullscreen}
                            aria-label={isFullscreen ? 'Exit temperature chart fullscreen' : 'Open temperature chart fullscreen'}
                            aria-pressed={isFullscreen}
                            aria-keyshortcuts="F"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border-none text-xs font-semibold cursor-pointer transition-all duration-200 bg-surface text-muted shadow-(--shadow-inset) hover:text-primary"
                        >
                            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                            <span className="font-(--font-mono) opacity-70">F</span>
                        </button>
                    </div>
                </div>

                <div className={`flex gap-6 flex-1 min-h-0 ${isFullscreen ? 'flex-row' : 'flex-col'}`}>
                    <div
                        ref={chartAreaRef}
                        className={`relative flex-1 flex flex-col min-w-0 outline-none ${
                            effectiveZoomRange
                                ? isChartDragging
                                    ? 'cursor-grabbing select-none touch-none'
                                    : 'cursor-grab touch-none'
                                : 'cursor-default'
                        }`}
                        onWheel={handleChartWheel}
                        onPointerDown={handleChartPointerDown}
                        onPointerMove={handleChartPointerMove}
                        onPointerUp={endChartDrag}
                        onPointerCancel={endChartDrag}
                        onKeyDown={handleChartKeyDown}
                        tabIndex={0}
                        role="region"
                        aria-label="Temperature curve chart. Use wheel or plus and minus to zoom, drag or use left and right arrows to pan, and 0 to reset zoom."
                    >
                        <ChartLegend />

                        {/* Phase labels — event-driven */}
                        <div className="flex gap-2 mb-3">
                            {[
                                { label: 'Drying', active: roastPhaseName === 'Drying' && charged },
                                { label: 'Maillard', active: roastPhaseName === 'Maillard' },
                                { label: 'Development', active: roastPhaseName === 'Development' },
                            ].map(({ label, active }) => (
                                <div
                                    key={label}
                                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium tracking-[0.3px] transition-all duration-300 ${
                                        active ? 'bg-primary text-white' : 'bg-surface text-muted shadow-(--shadow-inset)'
                                    }`}
                                >
                                    {label}
                                </div>
                            ))}
                        </div>

                        <RoastTempChart
                            xs={visibleXs}
                            btTarget={visibleBtTarget}
                            btActual={visibleBtActual}
                            etActual={visibleEtActual}
                            rorActual={visibleRorActual}
                            currentTimeSec={elapsed}
                            eventMarkers={eventMarkers}
                            turningPoints={turningPoints}
                            height={isFullscreen ? mainChartHeight : 350}
                            onCursorIdx={(idx) => {
                                if (idx != null) setHoveredChartIndex((effectiveZoomRange?.start ?? 0) + idx);
                            }}
                            onEventMarkerDrag={handleEventMarkerDrag}
                            showET={roastSettings.showET}
                            showTargetCurve={roastSettings.showTargetCurve}
                            showRoR={roastSettings.showRoRChart}
                            temperatureUnit={unit}
                        />
                        {livePoints.length === 0 && phase !== 'ended' && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="text-[13px] text-muted bg-main-bg/80 px-3 py-1.5 rounded-full">
                                    {phase === 'standby' ? '생두 투입 대기 중...' : '예열 중 — 실시간 온도 모니터링'}
                                </span>
                            </div>
                        )}
                    </div>

                    {isFullscreen && (
                        <div className="w-50 flex flex-col gap-3 px-3 pb-5 border-l border-border-subtle overflow-hidden">
                            <div className="grid grid-cols-1 gap-3">
                                {[
                                    { label: 'Bean Temp', value: formatTemp(rawBT, unit), color: '#ea580c' },
                                    { label: 'Env Temp', value: formatTemp(rawET, unit), color: '#2563eb' },
                                    { label: 'ROR', value: `${displayRoR}°${unit}/min`, color: '#7c3aed' },
                                    { label: 'Time', value: timeStr, color: 'var(--color-primary)' },
                                ].map((stat) => (
                                    <div key={stat.label} className="bg-surface px-2.5 py-2 rounded-xl shadow-(--shadow-inset)">
                                        <div className="text-[9px] text-muted font-semibold uppercase mb-0.5">{stat.label}</div>
                                        <div className="text-sm font-bold whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: stat.color }}>
                                            {stat.value}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-col gap-1.5">
                                    {phase === 'preheating' && (
                                        <button
                                            onClick={handleEnterStandby}
                                            className="flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold shadow-(--shadow-inset) bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer"
                                        >
                                            <Play size={12} />
                                            로스팅 준비
                                        </button>
                                    )}
                                    {phase === 'standby' && (
                                        <button
                                            onClick={handleManualCharge}
                                            className="flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold shadow-(--shadow-inset) bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer"
                                        >
                                            <Play size={12} />
                                            수동 Charge
                                        </button>
                                    )}
                                    <button
                                        onClick={handleEndRoastClick}
                                        disabled={roastEnded || !charged}
                                        aria-label="End roast"
                                        className={`flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold shadow-(--shadow-inset) ${
                                            roastEnded || !charged
                                                ? 'bg-surface text-muted cursor-default'
                                                : 'bg-[rgba(254,226,226,0.8)] text-[#dc2626] cursor-pointer'
                                        }`}
                                    >
                                        <Square size={12} />
                                        End Roast
                                    </button>
                                </div>
                                <EventButtons
                                    variant="sidebar"
                                    logEntries={logEntries}
                                    pressedButtons={pressedButtons}
                                    buttons={[
                                        { label: 'Yellow', event: 'Yellow', shortcut: '⌘1', pressKey: 'Mark Yellow', onClick: () => markEvent('Yellow', 'Color change visible', 'Mark Yellow') },
                                        { label: 'FC Start', event: 'FC Start', shortcut: '⌘2', pressKey: 'Mark FC Start', onClick: () => markEvent('FC Start', 'First crack started', 'Mark FC Start') },
                                        { label: 'FC End', event: 'FC End', shortcut: '⌘3', pressKey: 'Mark FC End', onClick: () => markEvent('FC End', 'First crack ended', 'Mark FC End') },
                                        { label: 'Mark Drop', event: 'Drop', shortcut: '⌘D', pressKey: 'Mark Drop', onClick: handleDrop },
                                    ]}
                                />
                            </div>
                            <RoastLog variant="sidebar" entries={roastLogDisplayEntries} eventMarkerColor={eventMarkerColor} />
                        </div>
                    )}
                </div>
            </div>

            {/* Controls + Log row */}
            <div className="grid grid-cols-2 gap-5">
                <div className="bg-main-bg rounded-lg px-6 py-5 shadow-(--shadow-ring)">
                    <h3 className="text-sm font-medium text-primary tracking-[0.14px] mb-4">Roast Controls</h3>
                    <div className="flex gap-2.5 mb-5">
                        {phase === 'preheating' && (
                            <button
                                onClick={handleEnterStandby}
                                aria-keyshortcuts="Meta+Enter Control+Enter"
                                className="flex-1 flex items-center justify-center gap-2 py-2.75 rounded-md border-none text-sm font-medium tracking-[0.14px] shadow-(--shadow-inset) bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer"
                            >
                                <Play size={15} strokeWidth={2} />
                                로스팅 준비
                            </button>
                        )}
                        {phase === 'standby' && (
                            <button
                                onClick={handleManualCharge}
                                aria-keyshortcuts="Meta+Enter Control+Enter"
                                className="flex-1 flex items-center justify-center gap-2 py-2.75 rounded-md border-none text-sm font-medium tracking-[0.14px] shadow-(--shadow-inset) bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer"
                            >
                                <Play size={15} strokeWidth={2} />
                                수동 Charge
                            </button>
                        )}
                        {(phase === 'roasting' || phase === 'ended') && (
                            <button
                                disabled={true}
                                className="flex-1 flex items-center justify-center gap-2 py-2.75 rounded-md border-none text-sm font-medium tracking-[0.14px] shadow-(--shadow-inset) bg-surface text-muted cursor-default"
                            >
                                <Play size={15} strokeWidth={2} />
                                Charged
                            </button>
                        )}
                        <button
                            onClick={handleEndRoastClick}
                            disabled={roastEnded || !charged}
                            aria-label="End roast"
                            className={`flex-1 flex items-center justify-center gap-2 py-2.75 rounded-md border-none text-sm font-medium tracking-[0.14px] ${
                                roastEnded || !charged
                                    ? 'bg-surface text-muted cursor-default shadow-(--shadow-inset)'
                                    : 'bg-[rgba(254,226,226,0.8)] text-[#dc2626] cursor-pointer shadow-(--shadow-card)'
                            }`}
                        >
                            <Square size={14} strokeWidth={2} />
                            End Roast
                        </button>
                    </div>
                    <EventButtons
                        variant="main"
                        logEntries={logEntries}
                        pressedButtons={pressedButtons}
                        buttons={[
                            { label: 'Mark Yellow', event: 'Yellow', shortcut: '⌘1', pressKey: 'Mark Yellow', onClick: () => markEvent('Yellow', 'Color change visible', 'Mark Yellow') },
                            { label: 'Mark FC Start', event: 'FC Start', shortcut: '⌘2', pressKey: 'Mark FC Start', onClick: () => markEvent('FC Start', 'First crack started', 'Mark FC Start') },
                            { label: 'Mark FC End', event: 'FC End', shortcut: '⌘3', pressKey: 'Mark FC End', onClick: () => markEvent('FC End', 'First crack ended', 'Mark FC End') },
                            { label: 'Mark Drop', event: 'Drop', shortcut: '⌘D', pressKey: 'Mark Drop', onClick: handleDrop },
                        ]}
                    />
                </div>

                <div className="bg-main-bg rounded-lg px-6 py-5 shadow-(--shadow-ring)">
                    <h3 className="text-sm font-medium text-primary tracking-[0.14px] mb-3.5">Roast Log</h3>
                    <RoastLog variant="main" entries={roastLogDisplayEntries} eventMarkerColor={eventMarkerColor} />
                </div>
            </div>

            <EndRoastModal
                open={showEndRoastModal}
                timeStr={timeStr}
                onClose={() => setShowEndRoastModal(false)}
                onConfirm={confirmEndRoast}
            />
            <RoastSummaryModal
                open={showSummaryModal}
                summaryData={summaryData}
                roastNotes={roastNotes}
                eventMarkerColor={eventMarkerColor}
                onRoastNotesChange={setRoastNotes}
                onClose={() => { setShowSummaryModal(false); setSummaryData(null); }}
                onDiscard={() => { setShowSummaryModal(false); setSummaryData(null); resetActiveRoast(); }}
            />
        </div>
    );
};
