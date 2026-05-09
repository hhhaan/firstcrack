import { useState, useEffect, useRef, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { Play, Square, Maximize2, Minimize2 } from 'lucide-react';
import { EndRoastModal } from '@widgets/active-roast/end-roast-modal/ui/EndRoastModal';
import {
    RoastSummaryModal,
    type RoastSummaryData,
} from '@widgets/active-roast/roast-summary-modal/ui/RoastSummaryModal';
import { RoastTempChart, type RoastEventMarker } from '@widgets/active-roast/ui/RoastTempChart';

import { fullData } from '@shared/data/roast-mock-data';
import type { RoastPoint, LogEntry } from '@shared/types/roast';
import { isEditableTarget } from '@shared/lib/dom';
import { sidecar } from '@shared/lib/sidecar';
import { useRoastSettings } from '@shared/store/roastSettings';
import { detectTurningPoints } from '@shared/lib/turningPoints';
import { toDisplayTemp, toDisplayRoR, formatTemp } from '@shared/lib/temperature';

import { RoastHeader, LiveReadings, MachineControls, EventButtons, RoastLog } from '@widgets/active-roast';

const TOGGLEABLE_LOG_EVENTS = new Set(['Yellow', 'FC Start', 'FC End']);

export const ActiveRoast = ({
    isActive,
    onOpenRoastSettings,
}: {
    isActive: boolean;
    onOpenRoastSettings?: () => void;
}) => {
    const roastSettings = useRoastSettings();
    const [elapsed, setElapsed] = useState(0);
    const [isRunning, setIsRunning] = useState(false);
    const isRunningRef = useRef(isRunning);
    isRunningRef.current = isRunning;
    const [charged, setCharged] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [roastEnded, setRoastEnded] = useState(false);
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
    const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);
    const [hoveredChartIndex, setHoveredChartIndex] = useState<number | null>(null);
    const [mainChartHeight, setMainChartHeight] = useState(260);
    const [isChartDragging, setIsChartDragging] = useState(false);
    const elapsedRef = useRef(0);
    const chargedRef = useRef(false);
    const roastStartTimeRef = useRef(0); // Date.now() at charge — 0.5s 해상도 livePoints용
    const tpTimeSecRef = useRef<number | null>(null);
    const chartAreaRef = useRef<HTMLDivElement>(null);
    const chartDragRef = useRef<{
        pointerId: number;
        startX: number;
        startRange: { start: number; end: number };
    } | null>(null);

    useEffect(() => {
        elapsedRef.current = elapsed;
    }, [elapsed]);
    useEffect(() => {
        chargedRef.current = charged;
    }, [charged]);

    const toggleFullscreen = () => {
        setIsFullscreen((prev) => !prev);
    };

    // Measure chart area height for fullscreen mode
    useEffect(() => {
        const el = chartAreaRef.current;
        if (!el) return;
        const obs = new ResizeObserver(() => {
            const h = el.offsetHeight;
            // subtract phase labels (~36px), RoR header (~24px), RoR chart (80px), margins
            setMainChartHeight(Math.max(180, h - 36 - 24 - 80 - 16));
        });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    useEffect(() => {
        if (!isRunning) return;
        const interval = setInterval(() => {
            setElapsed((e) => Math.min(e + 1, 780));
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

    useEffect(() => {
        if (!isRunning) return;
        const poll = async () => {
            try {
                const data = await sidecar.getTemperatures();
                setLiveData(data);
                setSidecarConnected(true);
                const bt = data.bt;
                if (chargedRef.current && bt != null && roastStartTimeRef.current !== 0) {
                    const t = (Date.now() - roastStartTimeRef.current) / 1000;
                    setLivePoints((prev) => {
                        // 0.4s 미만 간격은 스킵 (네트워크 지연으로 연속 응답 오는 경우 방지)
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
                }
            } catch {
                setSidecarConnected(false);
            }
        };
        poll();
        const id = setInterval(poll, roastSettings.pollIntervalMs);
        return () => clearInterval(id);
    }, [isRunning, roastSettings.pollIntervalMs]);

    useEffect(() => {
        if (!showEndRoastModal) return undefined;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isActive) return;
            if (event.key === 'Escape') {
                setShowEndRoastModal(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, showEndRoastModal]);

    const currentIndex = Math.floor(elapsed / 15);
    const currentPoint: RoastPoint | undefined = fullData[Math.min(currentIndex, fullData.length - 1)];

    const unit = roastSettings.temperatureUnit;

    // Prefer live sidecar data when connected; fall back to mock (raw °C)
    const rawBT = sidecarConnected && liveData?.bt != null ? liveData.bt : (currentPoint?.bt ?? null);
    const rawET = sidecarConnected && liveData?.et != null ? liveData.et : (currentPoint?.et ?? null);
    const displayBT = rawBT != null ? toDisplayTemp(rawBT, unit) : null;

    // 과거(livePoints 직접, 0.5s 해상도) + 미래(fullData target 커브) 합산
    const chartData = useMemo(() => {
        const lastLiveTime = livePoints.length > 0 ? livePoints[livePoints.length - 1].time : -1;
        const past = livePoints.map((p) => ({
            time: p.time,
            btActual: p.bt,
            etActual: p.et,
            rorActual: p.ror,
            etRorActual: p.ror_et,
            btTarget: null as number | null,
        }));
        const future = fullData
            .filter((p) => p.time > lastLiveTime)
            .map((p) => ({
                time: p.time,
                btActual: null as number | null,
                etActual: null as number | null,
                rorActual: null as number | null,
                etRorActual: null as number | null,
                btTarget: p.bt,
            }));
        return [...past, ...future];
    }, [livePoints]);
    // zoomRange는 초(seconds) 단위 시간 — 배열 인덱스가 아님
    // chartData가 성장해도 "30s~120s 구간"은 항상 같은 데이터를 가리킴
    const MAX_TIME = chartData.length > 0 ? chartData[chartData.length - 1].time : 780;
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

    const rorSpanPoints = Math.round(roastSettings.rorSpanSec / 15); // mock data is 15s/point
    const prevIndex = Math.max(0, currentIndex - rorSpanPoints);
    const rorNow =
        currentIndex > rorSpanPoints
            ? toDisplayRoR(
                  (fullData[currentIndex].bt - fullData[prevIndex].bt) / (roastSettings.rorSpanSec / 60),
                  unit,
              ).toFixed(1)
            : '—';
    const displayRoR =
        tpTimeSecRef.current == null
            ? '—'
            : sidecarConnected
              ? toDisplayRoR(liveData?.ror ?? 0, unit).toFixed(1)
              : rorNow;

    let phase = 'Drying';
    let phaseColor = '#d97706';
    if (elapsed > 630) {
        phase = 'Development';
        phaseColor = '#ea580c';
    } else if (elapsed > 300) {
        phase = 'Maillard';
        phaseColor = '#b45309';
    } else if (elapsed > 180) {
        phase = 'Yellowing';
        phaseColor = '#ca8a04';
    }

    const eventMarkerColor: Record<string, string> = {
        Yellow: '#ca8a04',
        'FC Start': '#ea580c',
        'FC End': '#dc2626',
        End: '#171717',
        Note: '#6b7280',
    };

    const eventMarkers = useMemo(
        (): RoastEventMarker[] =>
            logEntries
                .filter((e) => eventMarkerColor[e.event])
                .map((e) => {
                    const [min, sec] = e.time.split(':').map(Number);
                    const timeSec = Math.min(780, Math.max(0, min * 60 + sec));
                    return { timeSec, event: e.event, color: eventMarkerColor[e.event] };
                }),
        [logEntries],
    );

    const turningPoints = useMemo(
        () =>
            detectTurningPoints(
                livePoints.map((p) => p.time),
                livePoints.map((p) => p.bt),
            ),
        [livePoints],
    );
    const tpTimeSec = turningPoints[0]?.timeSec ?? null;
    tpTimeSecRef.current = tpTimeSec;

    // uPlot column arrays — derived from visibleChartData, converted to display unit
    const conv = (v: number | null) => (v != null ? toDisplayTemp(v, unit) : null);
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
        setTimeout(
            () =>
                setPressedButtons((prev) => {
                    const n = new Set(prev);
                    n.delete(label);
                    return n;
                }),
            600,
        );
    };

    const handleChartWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        if (MAX_TIME <= 0) return;

        event.preventDefault();

        const currentStart = effectiveZoomRange?.start ?? 0;
        const currentEnd = effectiveZoomRange?.end ?? MAX_TIME;
        const currentDuration = currentEnd - currentStart;

        if (event.deltaY < 0 && currentDuration <= MIN_VISIBLE_SECS) return;
        if (event.deltaY > 0 && currentStart === 0 && currentEnd === MAX_TIME) return;

        // uPlot 내부 Y축 너비(36px)와 우측 패딩(12px)을 제외한 실제 데이터 영역 기준으로 비율 계산
        const rect = event.currentTarget.getBoundingClientRect();
        const Y_AXIS_WIDTH = 36;
        const RIGHT_PAD = 12;
        const dataWidth = rect.width - Y_AXIS_WIDTH - RIGHT_PAD;
        const mouseX = event.clientX - rect.left - Y_AXIS_WIDTH;
        const pointerRatio = dataWidth > 0 ? Math.max(0, Math.min(1, mouseX / dataWidth)) : 0.5;
        const focusTime = currentStart + pointerRatio * currentDuration;

        const zoomFactor = event.deltaY < 0 ? 0.8 : 1.25;
        const nextDuration = Math.max(MIN_VISIBLE_SECS, Math.min(MAX_TIME, currentDuration * zoomFactor));

        if (nextDuration >= MAX_TIME) {
            setZoomRange(null);
            return;
        }

        // focusTime이 줌 전후 동일한 비율 위치에 유지되도록 start 계산
        let nextStart = focusTime - pointerRatio * nextDuration;
        let nextEnd = nextStart + nextDuration;

        if (nextStart < 0) {
            nextStart = 0;
            nextEnd = nextDuration;
        }
        if (nextEnd > MAX_TIME) {
            nextEnd = MAX_TIME;
            nextStart = MAX_TIME - nextDuration;
        }

        setZoomRange({ start: nextStart, end: nextEnd });
    };

    const zoomChart = (zoomFactor: number) => {
        if (MAX_TIME <= 0) return;

        const currentStart = effectiveZoomRange?.start ?? 0;
        const currentEnd = effectiveZoomRange?.end ?? MAX_TIME;
        const currentDuration = currentEnd - currentStart;

        const nextDuration = Math.max(MIN_VISIBLE_SECS, Math.min(MAX_TIME, currentDuration * zoomFactor));

        if (nextDuration >= MAX_TIME) {
            setZoomRange(null);
            return;
        }

        const focusTime =
            hoveredChartIndex != null
                ? (visibleChartData[hoveredChartIndex]?.time ?? (currentStart + currentEnd) / 2)
                : (currentStart + currentEnd) / 2;
        const ratio = currentDuration > 0 ? (focusTime - currentStart) / currentDuration : 0.5;
        let nextStart = focusTime - ratio * nextDuration;
        let nextEnd = nextStart + nextDuration;

        if (nextStart < 0) {
            nextStart = 0;
            nextEnd = nextDuration;
        }
        if (nextEnd > MAX_TIME) {
            nextEnd = MAX_TIME;
            nextStart = MAX_TIME - nextDuration;
        }

        setZoomRange({ start: nextStart, end: nextEnd });
    };

    const panChart = (direction: -1 | 1) => {
        if (!effectiveZoomRange) return;

        const duration = effectiveZoomRange.end - effectiveZoomRange.start;
        const step = Math.max(1, duration * 0.2);
        const nextStart = Math.max(0, Math.min(MAX_TIME - duration, effectiveZoomRange.start + step * direction));

        setZoomRange({ start: nextStart, end: nextStart + duration });
    };

    const getChartDataWidth = (rect: DOMRect) => {
        const Y_AXIS_WIDTH = 36;
        const RIGHT_PAD = 12;
        return Math.max(1, rect.width - Y_AXIS_WIDTH - RIGHT_PAD);
    };

    const handleChartPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!effectiveZoomRange || event.button !== 0) return;

        chartDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startRange: effectiveZoomRange,
        };
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

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        chartDragRef.current = null;
        setIsChartDragging(false);
    };

    const handleChartKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomChart(0.8);
            return;
        }
        if (event.key === '-' || event.key === '_') {
            event.preventDefault();
            zoomChart(1.25);
            return;
        }
        if (event.key === '0') {
            event.preventDefault();
            setZoomRange(null);
            return;
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            panChart(-1);
            return;
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            panChart(1);
        }
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

    const handleMarkNote = () => {
        const note = window.prompt('Note:');
        if (note?.trim()) markEvent('Note', note.trim(), 'Add Log Note');
    };

    const showMachineDisconnectedAlert = () => {
        if ('__TAURI_INTERNALS__' in window) {
            return message('머신이 연결되어 있지 않습니다. 머신을 먼저 연결한 뒤 로스팅을 시작하세요.', {
                title: '머신 연결 필요',
                kind: 'warning',
            });
        }
        return Promise.resolve();
    };

    const handleCharge = async () => {
        if (charged) return;
        const status = await sidecar.getStatus().catch(() => null);

        if (!status?.connected) {
            setSidecarConnected(false);
            await showMachineDisconnectedAlert();
            return;
        }

        setSidecarConnected(true);
        setMachineCapabilities(status.capabilities ?? []);
        // 시뮬레이터 타이머를 투입 시점에 맞춰 리셋 (실제 어댑터는 RoR 윈도우만 초기화)
        sidecar.startRoast().catch(() => {});
        roastStartTimeRef.current = Date.now();
        setCharged(true);
        setIsRunning(true);
        setLogEntries([{ time: '0:00', event: 'Charge', temp: formatTemp(rawBT, unit), note: 'Roast started' }]);
    };

    const resetActiveRoast = () => {
        roastStartTimeRef.current = 0;
        setElapsed(0);
        setIsRunning(false);
        setCharged(false);
        setRoastEnded(false);
        setLogEntries([]);
        setLivePoints([]);
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

        setShowEndRoastModal(false);
        setRoastNotes('');
        setShowSummaryModal(true);
        resetActiveRoast();
    };

    const handleEndRoastClick = () => {
        if (roastEnded) return;
        setShowEndRoastModal(true);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // CSS hide 상태에서도 window 이벤트를 수신하므로 비활성 시 차단
            if (!isActive) return;
            if (isEditableTarget(event.target) || showEndRoastModal || showSummaryModal) return;

            const shortcutModifier = event.metaKey || event.ctrlKey;
            const key = event.key.toLowerCase();

            if (event.key === 'Escape' && isFullscreen) {
                event.preventDefault();
                setIsFullscreen(false);
                return;
            }

            if (!shortcutModifier && event.code === 'KeyF') {
                event.preventDefault();
                toggleFullscreen();
                return;
            }

            if (shortcutModifier && event.key === 'Enter') {
                event.preventDefault();
                if (!charged) {
                    handleCharge();
                }
                return;
            }

            if (!shortcutModifier) return;

            if (event.key === '1') {
                event.preventDefault();
                markEvent('Yellow', 'Color change visible', 'Mark Yellow');
                return;
            }
            if (event.key === '2') {
                event.preventDefault();
                markEvent('FC Start', 'First crack started', 'Mark FC Start');
                return;
            }
            if (event.key === '3') {
                event.preventDefault();
                markEvent('FC End', 'First crack ended', 'Mark FC End');
                return;
            }
            if (key === 'n') {
                event.preventDefault();
                handleMarkNote();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, charged, displayBT, isFullscreen, roastEnded, showEndRoastModal, showSummaryModal, timeStr]);

    // Development time calculation
    const fcStartEntry = logEntries.find((e) => e.event === 'FC Start');
    const devTimeStr = (() => {
        if (!fcStartEntry) return '—';
        const [m, s] = fcStartEntry.time.split(':').map(Number);
        const devSec = elapsed - (m * 60 + s);
        if (devSec <= 0) return '—';
        const pct = Math.round((devSec / elapsed) * 100);
        return `${Math.floor(devSec / 60)}:${String(devSec % 60).padStart(2, '0')} (${pct}%)`;
    })();
    const roastLogDisplayEntries = useMemo(
        (): LogEntry[] => [
            ...logEntries,
            ...(!roastEnded
                ? [
                      {
                          time: timeStr,
                          event: 'Now',
                          temp: formatTemp(rawBT ?? currentPoint?.bt ?? null, unit),
                          note: `${phase} in progress`,
                          current: true,
                      },
                  ]
                : []),
        ],
        [logEntries, roastEnded, timeStr, displayBT, currentPoint, phase],
    );

    return (
        <div className="px-10 py-8 max-w-275 mx-auto">
            <RoastHeader
                roastEnded={roastEnded}
                charged={charged}
                sidecarConnected={sidecarConnected}
                timeStr={timeStr}
                phase={phase}
                onOpenRoastSettings={onOpenRoastSettings}
            />

            <LiveReadings
                rawBT={rawBT}
                rawET={rawET}
                displayRoR={displayRoR}
                unit={unit}
                phase={phase}
                phaseColor={phaseColor}
            />

            <MachineControls
                machineCapabilities={machineCapabilities}
                sidecarConnected={sidecarConnected}
                liveData={liveData}
            />

            {/* Temperature Chart */}
            <div
                className={`bg-main-bg flex flex-col mb-5 ${
                    isFullscreen
                        ? 'rounded-none fixed inset-0 z-9999 h-screen w-screen p-10'
                        : 'rounded-2xl relative z-1 shadow-(--shadow-ring) px-6 pb-4 pt-6'
                }`}
            >
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">Temperature Curve</h2>
                        {/* Inline Fullscreen Button in Chart Header */}
                        <button
                            onClick={toggleFullscreen}
                            aria-label={
                                isFullscreen ? 'Exit temperature chart fullscreen' : 'Open temperature chart fullscreen'
                            }
                            aria-pressed={isFullscreen}
                            aria-keyshortcuts="F"
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border-none text-xs font-semibold cursor-pointer transition-all duration-200 ${
                                isFullscreen
                                    ? 'bg-surface text-primary shadow-(--shadow-inset)'
                                    : 'bg-primary text-main-bg'
                            }`}
                        >
                            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}{' '}
                            <span className="font-(--font-mono) opacity-70">F</span>
                        </button>
                    </div>
                    <div className="flex gap-4 items-center">
                        {[
                            { color: '#171717', label: 'Bean Temp (BT)' },
                            { color: '#2563eb', label: 'Env Temp (ET)', dashed: true },
                            { color: '#d97706', label: 'Rate of Rise (ROR)' },
                        ].map(({ color, label, dashed }) => (
                            <div key={label} className="flex items-center gap-1.25">
                                <div
                                    style={{
                                        width: 16,
                                        height: 2,
                                        background: color,
                                        borderRadius: 1,
                                        opacity: dashed ? 0.5 : 1,
                                        backgroundImage: dashed
                                            ? `repeating-linear-gradient(to right, ${color} 0, ${color} 4px, transparent 4px, transparent 7px)`
                                            : 'none',
                                    }}
                                />
                                <span className="text-xs text-muted tracking-[0.14px]">{label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Fullscreen Content Layout */}
                <div className={`flex gap-6 flex-1 min-h-0 ${isFullscreen ? 'flex-row' : 'flex-col'}`}>
                    {/* Main Chart Area */}
                    <div
                        ref={chartAreaRef}
                        className={`flex-1 flex flex-col min-w-0 outline-none ${
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
                        {/* Phase labels */}
                        <div className="flex gap-2 mb-3">
                            {[
                                { label: 'Drying', range: '0:00–3:00', active: elapsed < 180 },
                                { label: 'Yellowing', range: '3:00–5:00', active: elapsed >= 180 && elapsed < 300 },
                                { label: 'Maillard', range: '5:00–10:30', active: elapsed >= 300 && elapsed < 630 },
                                { label: 'Development', range: '10:30→', active: elapsed >= 630 },
                            ].map(({ label, range, active }) => (
                                <div
                                    key={label}
                                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium tracking-[0.3px] transition-all duration-300 ${
                                        active
                                            ? 'bg-primary text-white'
                                            : 'bg-surface text-muted shadow-(--shadow-inset)'
                                    }`}
                                >
                                    {label} <span className="opacity-60">{range}</span>
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
                            height={isFullscreen ? mainChartHeight : 260}
                            onCursorIdx={(idx) => {
                                if (idx != null) setHoveredChartIndex((effectiveZoomRange?.start ?? 0) + idx);
                            }}
                            showET={roastSettings.showET}
                            showTargetCurve={roastSettings.showTargetCurve}
                            showRoR={roastSettings.showRoRChart}
                            temperatureUnit={unit}
                        />
                    </div>

                    {/* Fullscreen Sidebar (only visible in fullscreen) */}
                    {isFullscreen && (
                        <div className="w-50 flex flex-col gap-3 px-3 pb-5 border-l border-border-subtle overflow-hidden">
                            {/* Stats Grid */}
                            <div className="grid grid-cols-1 gap-3">
                                {[
                                    { label: 'Bean Temp', value: formatTemp(rawBT, unit), color: '#ea580c' },
                                    { label: 'Env Temp', value: formatTemp(rawET, unit), color: '#2563eb' },
                                    { label: 'ROR', value: `${displayRoR}°${unit}/min`, color: '#7c3aed' },
                                    { label: 'Time', value: timeStr, color: 'var(--color-primary)' },
                                ].map((stat) => (
                                    <div
                                        key={stat.label}
                                        className="bg-surface px-2.5 py-2 rounded-xl shadow-(--shadow-inset)"
                                    >
                                        <div className="text-[9px] text-muted font-semibold uppercase mb-0.5">
                                            {stat.label}
                                        </div>
                                        <div
                                            className="text-sm font-bold whitespace-nowrap overflow-hidden text-ellipsis"
                                            style={{ color: stat.color }}
                                        >
                                            {stat.value}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Controls */}
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-col gap-1.5">
                                    <button
                                        onClick={!charged ? handleCharge : undefined}
                                        disabled={charged}
                                        aria-keyshortcuts={!charged ? 'Meta+Enter Control+Enter' : undefined}
                                        className={`flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold shadow-(--shadow-inset) ${
                                            charged
                                                ? 'bg-surface text-muted cursor-default'
                                                : 'bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer'
                                        }`}
                                    >
                                        <Play size={12} />
                                        Charge
                                    </button>
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
                                        {
                                            label: 'Yellow',
                                            event: 'Yellow',
                                            shortcut: '⌘1',
                                            pressKey: 'Mark Yellow',
                                            onClick: () => markEvent('Yellow', 'Color change visible', 'Mark Yellow'),
                                        },
                                        {
                                            label: 'FC Start',
                                            event: 'FC Start',
                                            shortcut: '⌘2',
                                            pressKey: 'Mark FC Start',
                                            onClick: () =>
                                                markEvent('FC Start', 'First crack started', 'Mark FC Start'),
                                        },
                                        {
                                            label: 'FC End',
                                            event: 'FC End',
                                            shortcut: '⌘3',
                                            pressKey: 'Mark FC End',
                                            onClick: () => markEvent('FC End', 'First crack ended', 'Mark FC End'),
                                        },
                                        // TODO : Drop으로 바꿀지 고민해보기
                                        {
                                            label: 'Add Note',
                                            event: null,
                                            shortcut: '⌘N',
                                            pressKey: 'Add Log Note',
                                            onClick: handleMarkNote,
                                        },
                                    ]}
                                />
                            </div>

                            <RoastLog
                                variant="sidebar"
                                entries={roastLogDisplayEntries}
                                eventMarkerColor={eventMarkerColor}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Controls + Notes row */}
            <div className="grid grid-cols-2 gap-5">
                {/* Controls */}
                <div className="bg-main-bg rounded-2xl px-6 py-5 shadow-(--shadow-ring)">
                    <h3 className="text-sm font-medium text-primary tracking-[0.14px] mb-4">Roast Controls</h3>
                    <div className="flex gap-2.5 mb-5">
                        <button
                            onClick={!charged ? handleCharge : undefined}
                            disabled={charged}
                            aria-keyshortcuts={!charged ? 'Meta+Enter Control+Enter' : undefined}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.75 rounded-md border-none text-sm font-medium tracking-[0.14px] shadow-(--shadow-inset) ${
                                charged
                                    ? 'bg-surface text-muted cursor-default'
                                    : 'bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer'
                            }`}
                        >
                            <Play size={15} strokeWidth={2} />
                            Charge
                        </button>
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
                            {
                                label: 'Mark Yellow',
                                event: 'Yellow',
                                shortcut: '⌘1',
                                pressKey: 'Mark Yellow',
                                onClick: () => markEvent('Yellow', 'Color change visible', 'Mark Yellow'),
                            },
                            {
                                label: 'Mark FC Start',
                                event: 'FC Start',
                                shortcut: '⌘2',
                                pressKey: 'Mark FC Start',
                                onClick: () => markEvent('FC Start', 'First crack started', 'Mark FC Start'),
                            },
                            {
                                label: 'Mark FC End',
                                event: 'FC End',
                                shortcut: '⌘3',
                                pressKey: 'Mark FC End',
                                onClick: () => markEvent('FC End', 'First crack ended', 'Mark FC End'),
                            },
                            {
                                label: 'Add Log Note',
                                event: null,
                                shortcut: '⌘N',
                                pressKey: 'Add Log Note',
                                onClick: handleMarkNote,
                            },
                        ]}
                    />
                </div>

                <div className="bg-main-bg rounded-2xl px-6 py-5 shadow-(--shadow-ring)">
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
                onClose={() => {
                    setShowSummaryModal(false);
                    setSummaryData(null);
                }}
                onDiscard={() => {
                    setShowSummaryModal(false);
                    setSummaryData(null);
                    resetActiveRoast();
                }}
            />
        </div>
    );
};
