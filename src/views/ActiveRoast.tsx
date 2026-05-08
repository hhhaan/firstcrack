import { useState, useEffect, useRef, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { Play, Pause, Square, Thermometer, Wind, TrendingUp, AlertCircle, Maximize2, Minimize2, Settings2 } from 'lucide-react';
import { EndRoastModal } from '@widgets/active-roast/end-roast-modal/ui/EndRoastModal';
import {
    RoastSummaryModal,
    type RoastSummaryData,
} from '@widgets/active-roast/roast-summary-modal/ui/RoastSummaryModal';
import { RoastTempChart, type RoastEventMarker } from '@widgets/active-roast/ui/RoastTempChart';
import { RoastRorChart } from '@widgets/active-roast/ui/RoastRorChart';

import { fullData } from '@shared/data/roast-mock-data';
import type { RoastPoint } from '@shared/types/roast';
import { isEditableTarget } from '@shared/lib/dom';
import { sidecar } from '@shared/lib/sidecar';
import { useRoastSettings } from '@shared/store/roastSettings';
import { detectTurningPoints } from '@shared/lib/turningPoints';

type RoastLogEntry = { time: string; event: string; temp: string; note: string };
type RoastLogDisplayEntry = RoastLogEntry & { current?: boolean };

const TOGGLEABLE_LOG_EVENTS = new Set(['Yellow', 'FC Start', 'FC End']);

export const ActiveRoast = ({ isActive, onOpenRoastSettings }: { isActive: boolean; onOpenRoastSettings?: () => void }) => {
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
    const [logEntries, setLogEntries] = useState<RoastLogEntry[]>([]);
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
            if (ok) { unlisten?.(); win.close(); }
        }).then((fn) => { active ? (unlisten = fn) : fn(); });
        return () => { active = false; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!isRunning) return;
        const poll = async () => {
            try {
                const data = await sidecar.getTemperatures();
                setLiveData(data);
                setSidecarConnected(true);
                // TODO [T13]: 드럼/히터/팬 값 UI 표시 (현재 콘솔 확인용)
                console.log('[fc] heater=%d fan=%d drum=%s', data.heater, data.fan, data.drum);
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

    // Prefer live sidecar data when connected; fall back to mock
    const displayBT = sidecarConnected && liveData?.bt != null ? liveData.bt : (currentPoint?.bt ?? null);
    const displayET = sidecarConnected && liveData?.et != null ? liveData.et : (currentPoint?.et ?? null);

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
            ? ((fullData[currentIndex].bt - fullData[prevIndex].bt) / (roastSettings.rorSpanSec / 60)).toFixed(1)
            : '—';
    const displayRoR = tpTimeSecRef.current == null ? '—' : sidecarConnected ? (liveData?.ror ?? 0).toFixed(1) : rorNow;

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

    const eventMarkers = useMemo((): RoastEventMarker[] =>
        logEntries
            .filter((e) => eventMarkerColor[e.event])
            .map((e) => {
                const [min, sec] = e.time.split(':').map(Number);
                const timeSec = Math.min(780, Math.max(0, min * 60 + sec));
                return { timeSec, event: e.event, color: eventMarkerColor[e.event] };
            }),
    [logEntries]);

    const turningPoints = useMemo(
        () => detectTurningPoints(livePoints.map((p) => p.time), livePoints.map((p) => p.bt)),
        [livePoints],
    );
    const tpTimeSec = turningPoints[0]?.timeSec ?? null;
    tpTimeSecRef.current = tpTimeSec;

    // uPlot column arrays — derived from visibleChartData
    const visibleXs = useMemo(() => visibleChartData.map((p) => p.time), [visibleChartData]);
    const visibleBtTarget = useMemo(() => visibleChartData.map((p) => p.btTarget), [visibleChartData]);
    const visibleBtActual = useMemo(() => visibleChartData.map((p) => p.btActual), [visibleChartData]);
    const visibleEtActual = useMemo(() => visibleChartData.map((p) => p.etActual), [visibleChartData]);
    const visibleRorActual = useMemo(() => visibleChartData.map((p) => p.rorActual), [visibleChartData]);
    const visibleEtRorActual = useMemo(() => visibleChartData.map((p) => p.etRorActual ?? null), [visibleChartData]);

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

        if (nextDuration >= MAX_TIME) {
            setZoomRange(null);
            return;
        }

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

            return [...prev, { time: timeStr, event, temp: `${displayBT ?? '—'}°C`, note }];
        });
        if (!isRemoval && buttonLabel) flashButton(buttonLabel);
    };

    const handleMarkNote = () => {
        const note = window.prompt('Note:');
        if (note?.trim()) markEvent('Note', note.trim(), 'Add Log Note');
    };

    const showMachineDisconnectedAlert = () =>
        message('머신이 연결되어 있지 않습니다. 머신을 먼저 연결한 뒤 로스팅을 시작하세요.', {
            title: '머신 연결 필요',
            kind: 'warning',
        });

    const handleCharge = async () => {
        if (charged) return;
        const status = await sidecar.getStatus().catch(() => null);

        if (!status?.connected) {
            setSidecarConnected(false);
            await showMachineDisconnectedAlert();
            return;
        }

        setSidecarConnected(true);
        // 시뮬레이터 타이머를 투입 시점에 맞춰 리셋 (실제 어댑터는 RoR 윈도우만 초기화)
        sidecar.startRoast().catch(() => {});
        roastStartTimeRef.current = Date.now();
        setCharged(true);
        setIsRunning(true);
        setLogEntries([{ time: '0:00', event: 'Charge', temp: `${displayBT ?? '—'}°C`, note: 'Roast started' }]);
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
            { time: timeStr, event: 'End', temp: `${displayBT ?? '—'}°C`, note: 'Roast complete' },
        ];

        setSummaryData({
            totalTime: timeStr,
            development: devTimeStr,
            finalBt: `${displayBT ?? '—'}°C`,
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
                } else if (!roastEnded) {
                    setIsRunning((running) => !running);
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
    const roastLogDisplayEntries = useMemo((): RoastLogDisplayEntry[] => [
        ...logEntries,
        ...(!roastEnded
            ? [
                  {
                      time: timeStr,
                      event: 'Now',
                      temp: `${displayBT ?? currentPoint?.bt ?? '—'}°C`,
                      note: `${phase} in progress`,
                      current: true,
                  },
              ]
            : []),
    ], [logEntries, roastEnded, timeStr, displayBT, currentPoint, phase]);

    return (
        <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <div
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: roastEnded || !charged ? '#6b7280' : '#22c55e',
                                boxShadow: charged && !roastEnded ? '0 0 0 3px rgba(34,197,94,0.2)' : 'none',
                                animation: charged && !roastEnded ? 'pulse 2s infinite' : 'none',
                            }}
                        />
                        <span
                            style={{
                                fontSize: 12,
                                fontWeight: 500,
                                color: roastEnded || !charged ? '#6b7280' : '#16a34a',
                                letterSpacing: '0.5px',
                                textTransform: 'uppercase',
                            }}
                        >
                            {roastEnded
                                ? 'Roast Complete'
                                : !charged
                                  ? 'Ready to Roast'
                                  : sidecarConnected
                                    ? 'Live — Roast in Progress'
                                    : 'Mock — Roast in Progress'}
                        </span>
                    </div>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 300,
                            fontSize: 32,
                            lineHeight: 1.13,
                            color: 'var(--color-primary)',
                            letterSpacing: '-0.4px',
                            marginBottom: 4,
                        }}
                    >
                        {/* TODO: 현재 선택된 로스트 프로파일에서 빈 이름/원산지를 동적으로 읽어오도록 개선 */}
                        Ethiopia Yirgacheffe
                    </h1>
                    <p style={{ fontSize: 14, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                        Natural · Guji Zone · Profile: Signature Light
                    </p>
                </div>

                {/* Timer + Settings */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ textAlign: 'right' }}>
                        <div
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 44,
                                fontWeight: 600,
                                color: 'var(--color-primary)',
                                letterSpacing: '-2px',
                                lineHeight: 1,
                                marginBottom: 4,
                            }}
                        >
                            {timeStr}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                            {phase} phase
                        </div>
                    </div>
                    {onOpenRoastSettings && (
                        <button
                            onClick={onOpenRoastSettings}
                            aria-label="Open roast settings"
                            title="Roast settings"
                            style={{
                                width: 34,
                                height: 34,
                                borderRadius: 10,
                                border: 'none',
                                background: 'var(--color-surface)',
                                color: 'var(--color-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                flexShrink: 0,
                                boxShadow: 'var(--shadow-inset)',
                                marginTop: 6,
                            }}
                        >
                            <Settings2 size={15} strokeWidth={1.9} />
                        </button>
                    )}
                </div>
            </div>

            {/* Live readings */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                    {
                        label: 'Bean Temp',
                        value: `${displayBT ?? '—'}°C`,
                        icon: Thermometer,
                        color: '#ea580c',
                        bg: 'rgba(253,224,178,0.5)',
                    },
                    {
                        label: 'Env Temp',
                        value: `${displayET ?? '—'}°C`,
                        icon: Wind,
                        color: '#2563eb',
                        bg: 'rgba(219,234,254,0.5)',
                    },
                    {
                        label: 'Rate of Rise',
                        value: `${displayRoR}°/min`,
                        icon: TrendingUp,
                        color: '#7c3aed',
                        bg: 'rgba(237,233,254,0.5)',
                    },
                    { label: 'Phase', value: phase, icon: AlertCircle, color: phaseColor, bg: `rgba(253,224,178,0.3)` },
                ].map(({ label, value, icon: Icon, color, bg }) => (
                    <div
                        key={label}
                        style={{
                            background: 'var(--color-main-bg)',
                            borderRadius: 14,
                            padding: '16px 18px',
                            boxShadow: 'var(--shadow-ring)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <div
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 7,
                                    background: bg,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <Icon size={14} strokeWidth={2} color={color} />
                            </div>
                            <span
                                style={{
                                    fontSize: 12,
                                    color: 'var(--color-muted)',
                                    fontWeight: 500,
                                    letterSpacing: '0.5px',
                                    textTransform: 'uppercase',
                                }}
                            >
                                {label}
                            </span>
                        </div>
                        <div
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 22,
                                fontWeight: 600,
                                color: 'var(--color-primary)',
                                letterSpacing: '-0.5px',
                            }}
                        >
                            {value}
                        </div>
                    </div>
                ))}
            </div>

            {/* Temperature Chart */}
            <div
                style={{
                    background: 'var(--color-main-bg)',
                    borderRadius: isFullscreen ? 0 : 16,
                    padding: isFullscreen ? '40px 60px' : '24px 24px 16px',
                    boxShadow: isFullscreen ? 'none' : 'var(--shadow-ring)',
                    marginBottom: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    height: isFullscreen ? '100vh' : 'auto',
                    width: isFullscreen ? '100vw' : 'auto',
                    position: isFullscreen ? 'fixed' : 'relative',
                    top: 0,
                    left: 0,
                    zIndex: isFullscreen ? 9999 : 1,
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 20,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <h2
                            style={{
                                fontSize: 15,
                                fontWeight: 500,
                                color: 'var(--color-primary)',
                                letterSpacing: '0.15px',
                            }}
                        >
                            Temperature Curve
                        </h2>
                        {/* Inline Fullscreen Button in Chart Header */}
                        <button
                            onClick={toggleFullscreen}
                            aria-label={
                                isFullscreen ? 'Exit temperature chart fullscreen' : 'Open temperature chart fullscreen'
                            }
                            aria-pressed={isFullscreen}
                            aria-keyshortcuts="F"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '6px 12px',
                                borderRadius: 8,
                                border: 'none',
                                background: isFullscreen ? 'var(--color-surface)' : 'var(--color-primary)',
                                color: isFullscreen ? 'var(--color-primary)' : 'var(--color-main-bg)',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                boxShadow: isFullscreen ? 'var(--shadow-inset)' : 'none',
                            }}
                        >
                            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}{' '}
                            <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>F</span>
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        {[
                            { color: '#171717', label: 'Bean Temp (BT)' },
                            { color: '#2563eb', label: 'Env Temp (ET)', dashed: true },
                            { color: '#d97706', label: 'Rate of Rise (ROR)' },
                        ].map(({ color, label, dashed }) => (
                            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
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
                                <span style={{ fontSize: 12, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                                    {label}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Fullscreen Content Layout */}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: isFullscreen ? 'row' : 'column',
                        gap: 24,
                        flex: 1,
                        minHeight: 0,
                    }}
                >
                    {/* Main Chart Area */}
                    <div
                        ref={chartAreaRef}
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            minWidth: 0,
                            cursor: effectiveZoomRange ? (isChartDragging ? 'grabbing' : 'grab') : 'default',
                            userSelect: isChartDragging ? 'none' : 'auto',
                            touchAction: effectiveZoomRange ? 'none' : 'auto',
                        }}
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
                        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                            {[
                                { label: 'Drying', range: '0:00–3:00', active: elapsed < 180 },
                                { label: 'Yellowing', range: '3:00–5:00', active: elapsed >= 180 && elapsed < 300 },
                                { label: 'Maillard', range: '5:00–10:30', active: elapsed >= 300 && elapsed < 630 },
                                { label: 'Development', range: '10:30→', active: elapsed >= 630 },
                            ].map(({ label, range, active }) => (
                                <div
                                    key={label}
                                    style={{
                                        padding: '4px 10px',
                                        borderRadius: 9999,
                                        fontSize: 11,
                                        fontWeight: 500,
                                        letterSpacing: '0.3px',
                                        background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                                        color: active ? 'white' : 'var(--color-muted)',
                                        boxShadow: active ? 'none' : 'var(--shadow-inset)',
                                        transition: 'all 0.3s',
                                    }}
                                >
                                    {label} <span style={{ opacity: 0.6 }}>{range}</span>
                                </div>
                            ))}
                        </div>

                        <RoastTempChart
                            xs={visibleXs}
                            btTarget={visibleBtTarget}
                            btActual={visibleBtActual}
                            etActual={visibleEtActual}
                            currentTimeSec={elapsed}
                            eventMarkers={eventMarkers}
                            turningPoints={turningPoints}
                            height={isFullscreen ? mainChartHeight : 260}
                            onCursorIdx={(idx) => {
                                if (idx != null) setHoveredChartIndex((effectiveZoomRange?.start ?? 0) + idx);
                            }}
                            showET={roastSettings.showET}
                            showTargetCurve={roastSettings.showTargetCurve}
                        />

                        {/* RoR Sub-chart */}
                        {roastSettings.showRoRChart && (
                            <div style={{ marginTop: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, paddingLeft: 4 }}>
                                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Rate of Rise
                                    </span>
                                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#d97706' }}>
                                        {displayRoR}°/min
                                    </span>
                                </div>
                                <RoastRorChart xs={visibleXs} rorActual={visibleRorActual} etRorActual={visibleEtRorActual} height={80} showRoRET={roastSettings.showRoRET} />
                            </div>
                        )}
                    </div>

                    {/* Fullscreen Sidebar (only visible in fullscreen) */}
                    {isFullscreen && (
                        <div
                            style={{
                                width: 200,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 12,
                                padding: '0 12px 20px 12px',
                                borderLeft: '1px solid var(--color-border-subtle)',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Stats Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                                {[
                                    { label: 'Bean Temp', value: `${displayBT ?? '—'}°C`, color: '#ea580c' },
                                    { label: 'Env Temp', value: `${displayET ?? '—'}°C`, color: '#2563eb' },
                                    { label: 'ROR', value: `${displayRoR}°/min`, color: '#7c3aed' },
                                    { label: 'Time', value: timeStr, color: 'var(--color-primary)' },
                                ].map((stat) => (
                                    <div
                                        key={stat.label}
                                        style={{
                                            background: 'var(--color-surface)',
                                            padding: '8px 10px',
                                            borderRadius: 10,
                                            boxShadow: 'var(--shadow-inset)',
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: 9,
                                                color: 'var(--color-muted)',
                                                fontWeight: 600,
                                                textTransform: 'uppercase',
                                                marginBottom: 2,
                                            }}
                                        >
                                            {stat.label}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 14,
                                                fontWeight: 700,
                                                color: stat.color,
                                                fontFamily: 'var(--font-mono)',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}
                                        >
                                            {stat.value}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Controls */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {!charged ? (
                                        <button
                                            onClick={handleCharge}
                                            aria-keyshortcuts="Meta+Enter Control+Enter"
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: 4,
                                                padding: '8px 0',
                                                borderRadius: 9999,
                                                border: 'none',
                                                background: '#ea580c',
                                                color: 'white',
                                                fontSize: 12,
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                boxShadow: 'var(--shadow-card)',
                                            }}
                                        >
                                            <Play size={12} />
                                            Charge
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => setIsRunning((r) => !r)}
                                            aria-keyshortcuts="Meta+Enter Control+Enter"
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: 4,
                                                padding: '8px 0',
                                                borderRadius: 9999,
                                                border: 'none',
                                                background: 'var(--color-primary)',
                                                color: 'white',
                                                fontSize: 12,
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                boxShadow: 'var(--shadow-card)',
                                            }}
                                        >
                                            {isRunning ? <Pause size={12} /> : <Play size={12} />}
                                            {isRunning ? 'Pause' : 'Resume'}
                                        </button>
                                    )}
                                    <button
                                        onClick={handleEndRoastClick}
                                        disabled={roastEnded}
                                        aria-label="End roast"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 4,
                                            padding: '8px 0',
                                            borderRadius: 9999,
                                            border: 'none',
                                            background: roastEnded ? 'var(--color-surface)' : 'rgba(254,226,226,0.8)',
                                            color: roastEnded ? 'var(--color-muted)' : '#dc2626',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            cursor: roastEnded ? 'default' : 'pointer',
                                            boxShadow: 'var(--shadow-inset)',
                                        }}
                                    >
                                        <Square size={12} />
                                        End
                                    </button>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                                    {[
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
                                        {
                                            label: 'Add Note',
                                            event: null,
                                            shortcut: '⌘N',
                                            pressKey: 'Add Log Note',
                                            onClick: handleMarkNote,
                                        },
                                    ].map(({ label, event, shortcut, pressKey, onClick }) => {
                                        const registered = event ? logEntries.some((entry) => entry.event === event) : false;
                                        const pressed = pressedButtons.has(pressKey);
                                        return (
                                            <button
                                                key={label}
                                                onClick={onClick}
                                                aria-keyshortcuts={`Meta+${shortcut.replace('⌘', '')} Control+${shortcut.replace('⌘', '')}`}
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    gap: 2,
                                                    padding: '8px 4px',
                                                    borderRadius: 8,
                                                    border: registered && !pressed ? '1.5px solid var(--color-primary)' : 'none',
                                                    background: pressed
                                                        ? 'var(--color-primary)'
                                                        : 'var(--color-surface)',
                                                    color: pressed ? 'white' : registered ? 'var(--color-primary)' : 'var(--color-secondary)',
                                                    fontSize: 11,
                                                    fontWeight: registered || pressed ? 600 : 500,
                                                    cursor: 'pointer',
                                                    boxShadow: pressed || registered ? 'none' : 'var(--shadow-inset)',
                                                    transition: 'background 0.15s, color 0.15s, border 0.15s',
                                                }}
                                            >
                                                <span>{label}</span>
                                                <span
                                                    style={{
                                                        fontSize: 10,
                                                        color: pressed ? 'rgba(255,255,255,0.6)' : registered ? 'var(--color-secondary)' : 'var(--color-muted)',
                                                        fontFamily: 'var(--font-mono)',
                                                        transition: 'color 0.15s',
                                                    }}
                                                >
                                                    {shortcut}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Roast Log */}
                            <div
                                style={{
                                    flex: 1,
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    minHeight: 0,
                                }}
                            >
                                <h3
                                    style={{
                                        fontSize: 12,
                                        color: 'var(--color-muted)',
                                        fontWeight: 600,
                                        textTransform: 'uppercase',
                                        marginBottom: 10,
                                        flexShrink: 0,
                                    }}
                                >
                                    Roast Log
                                </h3>
                                <div style={{ overflowY: 'auto', flex: 1 }}>
                                    {roastLogDisplayEntries.map((entry, i, arr) => (
                                        <div
                                            key={i}
                                            style={{
                                                display: 'flex',
                                                gap: 10,
                                                padding: '8px 0',
                                                borderBottom:
                                                    i < arr.length - 1
                                                        ? '1px solid var(--color-border-subtle)'
                                                        : 'none',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    fontFamily: 'var(--font-mono)',
                                                    fontSize: 11,
                                                    color: 'var(--color-muted)',
                                                    width: 32,
                                                    flexShrink: 0,
                                                    paddingTop: 2,
                                                }}
                                            >
                                                {entry.time}
                                            </div>
                                            <div
                                                style={{
                                                    width: 6,
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    paddingTop: 4,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: 6,
                                                        height: 6,
                                                        borderRadius: '50%',
                                                        background: entry.current
                                                            ? '#22c55e'
                                                            : (eventMarkerColor[entry.event] ?? 'var(--color-border)'),
                                                        boxShadow: entry.current
                                                            ? '0 0 0 2px rgba(34,197,94,0.2)'
                                                            : 'none',
                                                    }}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span
                                                        style={{
                                                            fontSize: 12,
                                                            fontWeight: 500,
                                                            color: 'var(--color-primary)',
                                                        }}
                                                    >
                                                        {entry.event}
                                                    </span>
                                                    <span
                                                        style={{
                                                            fontFamily: 'var(--font-mono)',
                                                            fontSize: 11,
                                                            color: 'var(--color-muted)',
                                                        }}
                                                    >
                                                        {entry.temp}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                                                    {entry.note}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Controls + Notes row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Controls */}
                <div
                    style={{
                        background: 'var(--color-main-bg)',
                        borderRadius: 16,
                        padding: '20px 24px',
                        boxShadow: 'var(--shadow-ring)',
                    }}
                >
                    <h3
                        style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: 'var(--color-primary)',
                            letterSpacing: '0.14px',
                            marginBottom: 16,
                        }}
                    >
                        Roast Controls
                    </h3>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                        {!charged ? (
                            <button
                                onClick={handleCharge}
                                aria-keyshortcuts="Meta+Enter Control+Enter"
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    padding: '11px 0',
                                    borderRadius: 9999,
                                    border: 'none',
                                    background: '#ea580c',
                                    color: 'white',
                                    fontSize: 14,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    boxShadow: 'var(--shadow-card)',
                                    letterSpacing: '0.14px',
                                }}
                            >
                                <Play size={15} strokeWidth={2} />
                                Charge
                            </button>
                        ) : (
                            <button
                                onClick={() => setIsRunning((r) => !r)}
                                aria-keyshortcuts="Meta+Enter Control+Enter"
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    padding: '11px 0',
                                    borderRadius: 9999,
                                    border: 'none',
                                    background: 'var(--color-primary)',
                                    color: 'white',
                                    fontSize: 14,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    boxShadow: 'var(--shadow-card)',
                                    letterSpacing: '0.14px',
                                }}
                            >
                                {isRunning ? <Pause size={15} strokeWidth={2} /> : <Play size={15} strokeWidth={2} />}
                                {isRunning ? 'Pause' : 'Resume'}
                            </button>
                        )}
                        <button
                            onClick={handleEndRoastClick}
                            disabled={roastEnded}
                            aria-label="End roast"
                            style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                padding: '11px 0',
                                borderRadius: 9999,
                                border: 'none',
                                background: roastEnded ? 'var(--color-surface)' : 'rgba(254,226,226,0.8)',
                                color: roastEnded ? 'var(--color-muted)' : '#dc2626',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: roastEnded ? 'default' : 'pointer',
                                letterSpacing: '0.14px',
                                boxShadow: 'var(--shadow-inset)',
                            }}
                        >
                            <Square size={14} strokeWidth={2} />
                            End Roast
                        </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {[
                            {
                                label: 'Mark Yellow',
                                event: 'Yellow',
                                shortcut: '⌘1',
                                onClick: () => markEvent('Yellow', 'Color change visible', 'Mark Yellow'),
                            },
                            {
                                label: 'Mark FC Start',
                                event: 'FC Start',
                                shortcut: '⌘2',
                                onClick: () => markEvent('FC Start', 'First crack started', 'Mark FC Start'),
                            },
                            {
                                label: 'Mark FC End',
                                event: 'FC End',
                                shortcut: '⌘3',
                                onClick: () => markEvent('FC End', 'First crack ended', 'Mark FC End'),
                            },
                            { label: 'Add Log Note', event: null, shortcut: '⌘N', onClick: handleMarkNote },
                        ].map(({ label, event, shortcut, onClick }) => {
                            const registered = event ? logEntries.some((entry) => entry.event === event) : false;
                            const pressed = pressedButtons.has(label);
                            return (
                                <button
                                    key={label}
                                    onClick={onClick}
                                    aria-keyshortcuts={`Meta+${shortcut.replace('⌘', '')} Control+${shortcut.replace('⌘', '')}`}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '9px 12px',
                                        borderRadius: 8,
                                        border: registered && !pressed ? '1.5px solid var(--color-primary)' : 'none',
                                        background: pressed ? 'var(--color-primary)' : 'var(--color-surface)',
                                        color: pressed ? 'white' : registered ? 'var(--color-primary)' : 'var(--color-secondary)',
                                        fontSize: 13,
                                        fontWeight: registered || pressed ? 600 : 500,
                                        cursor: 'pointer',
                                        letterSpacing: '0.14px',
                                        boxShadow: pressed || registered ? 'none' : 'var(--shadow-inset)',
                                        transition: 'background 0.15s, color 0.15s, border 0.15s',
                                    }}
                                >
                                    {label}
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: pressed ? 'rgba(255,255,255,0.6)' : registered ? 'var(--color-secondary)' : 'var(--color-muted)',
                                            fontFamily: 'var(--font-mono)',
                                            transition: 'color 0.15s',
                                        }}
                                    >
                                        {shortcut}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Roast log */}
                <div
                    style={{
                        background: 'var(--color-main-bg)',
                        borderRadius: 16,
                        padding: '20px 24px',
                        boxShadow: 'var(--shadow-ring)',
                    }}
                >
                    <h3
                        style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: 'var(--color-primary)',
                            letterSpacing: '0.14px',
                            marginBottom: 14,
                        }}
                    >
                        Roast Log
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {roastLogDisplayEntries.map((entry, i, arr) => (
                            <div
                                key={i}
                                style={{
                                    display: 'flex',
                                    gap: 12,
                                    padding: '10px 0',
                                    borderBottom: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                                }}
                            >
                                <div
                                    style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: 12,
                                        color: 'var(--color-muted)',
                                        width: 36,
                                        flexShrink: 0,
                                        paddingTop: 1,
                                    }}
                                >
                                    {entry.time}
                                </div>
                                <div
                                    style={{
                                        width: 6,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        paddingTop: 4,
                                        flexShrink: 0,
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 7,
                                            height: 7,
                                            borderRadius: '50%',
                                            background: entry.current
                                                ? '#22c55e'
                                                : (eventMarkerColor[entry.event] ?? 'var(--color-border)'),
                                            flexShrink: 0,
                                            boxShadow: entry.current
                                                ? '0 0 0 3px rgba(34,197,94,0.2)'
                                                : 'none',
                                        }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span
                                            style={{
                                                fontSize: 13,
                                                fontWeight: 500,
                                                color: 'var(--color-primary)',
                                                letterSpacing: '0.14px',
                                            }}
                                        >
                                            {entry.event}
                                        </span>
                                        <span
                                            style={{
                                                fontFamily: 'var(--font-mono)',
                                                fontSize: 12,
                                                color: 'var(--color-muted)',
                                            }}
                                        >
                                            {entry.temp}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                                        {entry.note}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
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
            />
        </div>
    );
};
