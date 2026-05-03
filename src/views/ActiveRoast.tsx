import { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, Square, Thermometer, Wind, TrendingUp, AlertCircle, Maximize2, Minimize2 } from 'lucide-react';
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

export const ActiveRoast = ({ isActive }: { isActive: boolean }) => {
    const [elapsed, setElapsed] = useState(0);
    const [isRunning, setIsRunning] = useState(false);
    const [charged, setCharged] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [roastEnded, setRoastEnded] = useState(false);
    const [showEndRoastModal, setShowEndRoastModal] = useState(false);
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [summaryData, setSummaryData] = useState<RoastSummaryData | null>(null);
    const [roastNotes, setRoastNotes] = useState('');
    const [pressedButtons, setPressedButtons] = useState<Set<string>>(new Set());
    const [logEntries, setLogEntries] = useState<{ time: string; event: string; temp: string; note: string }[]>([]);
    const [liveData, setLiveData] = useState<{
        bt: number | null;
        et: number | null;
        ror: number;
        heater: number;
        fan: number;
    } | null>(null);
    const [sidecarConnected, setSidecarConnected] = useState(false);
    const [livePoints, setLivePoints] = useState<
        { time: number; label: string; bt: number; et: number; ror: number }[]
    >([]);
    const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);
    const [hoveredChartIndex, setHoveredChartIndex] = useState<number | null>(null);
    const [mainChartHeight, setMainChartHeight] = useState(260);
    const elapsedRef = useRef(0);
    const chargedRef = useRef(false);
    const chartAreaRef = useRef<HTMLDivElement>(null);

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

    // TODO: expose poll interval as user setting (3000ms → 1000ms → 500ms)
    const POLL_INTERVAL_MS = 500;
    useEffect(() => {
        if (!isRunning) return;
        const poll = async () => {
            try {
                const data = await sidecar.getTemperatures();
                setLiveData(data);
                setSidecarConnected(true);
                const bt = data.bt;
                if (chargedRef.current && bt != null) {
                    const t = elapsedRef.current;
                    setLivePoints((prev) => {
                        // 같은 초에 중복 포인트 방지 (poll 0.5s, elapsed 1s)
                        if (prev.length > 0 && prev[prev.length - 1].time === t) return prev;
                        const min = Math.floor(t / 60);
                        const sec = t % 60;
                        return [
                            ...prev,
                            {
                                time: t,
                                label: `${min}:${String(sec).padStart(2, '0')}`,
                                bt,
                                et: data.et ?? 0,
                                ror: data.ror,
                            },
                        ];
                    });
                }
            } catch {
                setSidecarConnected(false);
            }
        };
        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [isRunning]);

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

    // X축은 fullData 기준 고정(0–13분), livePoints를 가장 가까운 15초 버킷에 매핑
    const chartData = useMemo(() => {
        const lastLiveTime = livePoints.length > 0 ? livePoints[livePoints.length - 1].time : -1;
        const liveBySecond = new Map(livePoints.map((p) => [p.time, p]));
        return fullData.map((p) => {
            if (p.time > lastLiveTime) {
                return {
                    label: p.label,
                    btActual: null as number | null,
                    etActual: null as number | null,
                    rorActual: null as number | null,
                    btTarget: p.bt,
                };
            }
            let live = liveBySecond.get(p.time);
            if (!live) {
                for (let t = p.time - 1; t >= Math.max(0, p.time - 14); t--) {
                    live = liveBySecond.get(t);
                    if (live) break;
                }
            }
            return {
                label: p.label,
                btActual: live?.bt ?? null,
                etActual: live?.et ?? null,
                rorActual: live ? Math.max(0, live.ror) : null,
                btTarget: null as number | null,
            };
        });
    }, [livePoints]);
    const totalChartPoints = chartData.length;
    const effectiveZoomRange = zoomRange
        ? {
              start: Math.max(0, Math.min(zoomRange.start, Math.max(0, totalChartPoints - 1))),
              end: Math.max(0, Math.min(zoomRange.end, Math.max(0, totalChartPoints - 1))),
          }
        : null;
    const visibleChartData = effectiveZoomRange
        ? chartData.slice(effectiveZoomRange.start, effectiveZoomRange.end + 1)
        : chartData;

    const elapsedMin = Math.floor(elapsed / 60);
    const elapsedSec = elapsed % 60;
    const timeStr = `${elapsedMin}:${String(elapsedSec).padStart(2, '0')}`;

    const prevIndex = Math.max(0, currentIndex - 4);
    const rorNow =
        currentIndex > 4 ? ((fullData[currentIndex].bt - fullData[prevIndex].bt) / (60 / 60)).toFixed(1) : '—';
    const displayRoR = sidecarConnected ? (liveData?.ror ?? 0).toFixed(1) : rorNow;

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
                const totalSec = min * 60 + sec;
                const closest = fullData.reduce((prev, curr) =>
                    Math.abs(curr.time - totalSec) < Math.abs(prev.time - totalSec) ? curr : prev,
                );
                return { timeSec: closest.time, event: e.event, color: eventMarkerColor[e.event] };
            }),
    [logEntries]);

    // uPlot column arrays — derived from visibleChartData
    const visibleXs = useMemo(() => {
        const start = effectiveZoomRange?.start ?? 0;
        return visibleChartData.map((_, i) => fullData[start + i].time);
    }, [visibleChartData, effectiveZoomRange]);
    const visibleBtTarget = useMemo(() => visibleChartData.map((p) => p.btTarget), [visibleChartData]);
    const visibleBtActual = useMemo(() => visibleChartData.map((p) => p.btActual), [visibleChartData]);
    const visibleEtActual = useMemo(() => visibleChartData.map((p) => p.etActual), [visibleChartData]);
    const visibleRorActual = useMemo(() => visibleChartData.map((p) => p.rorActual), [visibleChartData]);

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
        if (totalChartPoints <= 1) return;

        event.preventDefault();

        const currentStart = effectiveZoomRange?.start ?? 0;
        const currentEnd = effectiveZoomRange?.end ?? totalChartPoints - 1;
        const currentSize = currentEnd - currentStart + 1;
        const minVisiblePoints = Math.min(12, totalChartPoints);

        if (event.deltaY < 0 && currentSize <= minVisiblePoints) return;
        if (event.deltaY > 0 && currentStart === 0 && currentEnd === totalChartPoints - 1) return;

        // uPlot 내부 Y축 너비(36px)와 우측 패딩(12px)을 제외한 실제 데이터 영역 기준으로 비율 계산
        const rect = event.currentTarget.getBoundingClientRect();
        const Y_AXIS_WIDTH = 36;
        const RIGHT_PAD = 12;
        const dataWidth = rect.width - Y_AXIS_WIDTH - RIGHT_PAD;
        const mouseX = event.clientX - rect.left - Y_AXIS_WIDTH;
        const pointerRatio = dataWidth > 0 ? Math.max(0, Math.min(1, mouseX / dataWidth)) : 0.5;
        const focusIndex = Math.round(currentStart + (currentSize - 1) * pointerRatio);

        const zoomFactor = event.deltaY < 0 ? 0.8 : 1.25;
        const nextSize = Math.max(minVisiblePoints, Math.min(totalChartPoints, Math.round(currentSize * zoomFactor)));

        if (nextSize >= totalChartPoints) {
            setZoomRange(null);
            return;
        }

        // focusIndex가 줌 전후 동일한 비율 위치에 유지되도록 start 계산
        let nextStart = Math.round(focusIndex - (focusIndex - currentStart) * (nextSize / currentSize));
        let nextEnd = nextStart + nextSize - 1;

        if (nextStart < 0) {
            nextStart = 0;
            nextEnd = nextSize - 1;
        }
        if (nextEnd > totalChartPoints - 1) {
            nextEnd = totalChartPoints - 1;
            nextStart = nextEnd - nextSize + 1;
        }

        setZoomRange({ start: nextStart, end: nextEnd });
    };

    const zoomChart = (zoomFactor: number) => {
        if (totalChartPoints <= 1) return;

        const currentStart = effectiveZoomRange?.start ?? 0;
        const currentEnd = effectiveZoomRange?.end ?? totalChartPoints - 1;
        const currentSize = currentEnd - currentStart + 1;
        const minVisiblePoints = Math.min(12, totalChartPoints);

        const nextSize = Math.max(minVisiblePoints, Math.min(totalChartPoints, Math.round(currentSize * zoomFactor)));

        if (nextSize >= totalChartPoints) {
            setZoomRange(null);
            return;
        }

        const focusIndex = Math.max(
            currentStart,
            Math.min(currentEnd, hoveredChartIndex ?? Math.round((currentStart + currentEnd) / 2)),
        );
        let nextStart = Math.round(focusIndex - (focusIndex - currentStart) * (nextSize / currentSize));
        let nextEnd = nextStart + nextSize - 1;

        if (nextStart < 0) {
            nextStart = 0;
            nextEnd = nextSize - 1;
        }
        if (nextEnd > totalChartPoints - 1) {
            nextEnd = totalChartPoints - 1;
            nextStart = nextEnd - nextSize + 1;
        }

        setZoomRange({ start: nextStart, end: nextEnd });
    };

    const panChart = (direction: -1 | 1) => {
        if (!effectiveZoomRange) return;

        const size = effectiveZoomRange.end - effectiveZoomRange.start + 1;
        const step = Math.max(1, Math.round(size * 0.2));
        const nextStart = Math.max(0, Math.min(totalChartPoints - size, effectiveZoomRange.start + step * direction));

        setZoomRange({ start: nextStart, end: nextStart + size - 1 });
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
        setLogEntries((prev) => [...prev, { time: timeStr, event, temp: `${displayBT ?? '—'}°C`, note }]);
        if (buttonLabel) flashButton(buttonLabel);
    };

    const handleMarkNote = () => {
        const note = window.prompt('Note:');
        if (note?.trim()) markEvent('Note', note.trim(), 'Add Log Note');
    };

    const handleCharge = () => {
        if (charged) return;
        setCharged(true);
        setIsRunning(true);
        setLogEntries([{ time: '0:00', event: 'Charge', temp: `${displayBT ?? '—'}°C`, note: 'Roast started' }]);
    };

    const resetActiveRoast = () => {
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

                {/* Timer */}
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
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
                        onWheel={handleChartWheel}
                        onKeyDown={handleChartKeyDown}
                        tabIndex={0}
                        role="region"
                        aria-label="Temperature curve chart. Use plus and minus to zoom, left and right arrows to pan, and 0 to reset zoom."
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
                            height={isFullscreen ? mainChartHeight : 260}
                            onCursorIdx={(idx) => {
                                if (idx != null) setHoveredChartIndex((effectiveZoomRange?.start ?? 0) + idx);
                            }}
                        />

                        {/* RoR Sub-chart */}
                        <div style={{ marginTop: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, paddingLeft: 4 }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    Rate of Rise
                                </span>
                                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#d97706' }}>
                                    {displayRoR}°/min
                                </span>
                            </div>
                            <RoastRorChart xs={visibleXs} rorActual={visibleRorActual} height={80} />
                        </div>
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
                                            shortcut: '⌘1',
                                            pressKey: 'Mark Yellow',
                                            onClick: () => markEvent('Yellow', 'Color change visible', 'Mark Yellow'),
                                        },
                                        {
                                            label: 'FC Start',
                                            shortcut: '⌘2',
                                            pressKey: 'Mark FC Start',
                                            onClick: () =>
                                                markEvent('FC Start', 'First crack started', 'Mark FC Start'),
                                        },
                                        {
                                            label: 'FC End',
                                            shortcut: '⌘3',
                                            pressKey: 'Mark FC End',
                                            onClick: () => markEvent('FC End', 'First crack ended', 'Mark FC End'),
                                        },
                                        {
                                            label: 'Add Note',
                                            shortcut: '⌘N',
                                            pressKey: 'Add Log Note',
                                            onClick: handleMarkNote,
                                        },
                                    ].map(({ label, shortcut, pressKey, onClick }) => {
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
                                                    border: 'none',
                                                    background: pressed
                                                        ? 'var(--color-primary)'
                                                        : 'var(--color-surface)',
                                                    color: pressed ? 'white' : 'var(--color-secondary)',
                                                    fontSize: 11,
                                                    fontWeight: 500,
                                                    cursor: 'pointer',
                                                    boxShadow: pressed ? 'none' : 'var(--shadow-inset)',
                                                    transition: 'background 0.15s, color 0.15s',
                                                }}
                                            >
                                                <span>{label}</span>
                                                <span
                                                    style={{
                                                        fontSize: 10,
                                                        color: pressed ? 'rgba(255,255,255,0.6)' : 'var(--color-muted)',
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
                                    {[
                                        ...logEntries,
                                        ...(!roastEnded
                                            ? [
                                                  {
                                                      time: timeStr,
                                                      event: 'Now',
                                                      temp: `${currentPoint?.bt}°C`,
                                                      note: `${phase} in progress`,
                                                      current: true,
                                                  },
                                              ]
                                            : []),
                                    ].map((entry, i, arr) => (
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
                                                        background: (entry as any).current
                                                            ? '#22c55e'
                                                            : (eventMarkerColor[entry.event] ?? 'var(--color-border)'),
                                                        boxShadow: (entry as any).current
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
                                shortcut: '⌘1',
                                onClick: () => markEvent('Yellow', 'Color change visible', 'Mark Yellow'),
                            },
                            {
                                label: 'Mark FC Start',
                                shortcut: '⌘2',
                                onClick: () => markEvent('FC Start', 'First crack started', 'Mark FC Start'),
                            },
                            {
                                label: 'Mark FC End',
                                shortcut: '⌘3',
                                onClick: () => markEvent('FC End', 'First crack ended', 'Mark FC End'),
                            },
                            { label: 'Add Log Note', shortcut: '⌘N', onClick: handleMarkNote },
                        ].map(({ label, shortcut, onClick }) => {
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
                                        border: 'none',
                                        background: pressed ? 'var(--color-primary)' : 'var(--color-surface)',
                                        color: pressed ? 'white' : 'var(--color-secondary)',
                                        fontSize: 13,
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        letterSpacing: '0.14px',
                                        boxShadow: pressed ? 'none' : 'var(--shadow-inset)',
                                        transition: 'background 0.15s, color 0.15s',
                                    }}
                                >
                                    {label}
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: pressed ? 'rgba(255,255,255,0.6)' : 'var(--color-muted)',
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
                        {[
                            ...logEntries,
                            ...(!roastEnded
                                ? [
                                      {
                                          time: timeStr,
                                          event: 'Now',
                                          temp: `${currentPoint?.bt}°C`,
                                          note: `${phase} in progress`,
                                          current: true,
                                      },
                                  ]
                                : []),
                        ].map((entry, i, arr) => (
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
                                            background: (entry as any).current ? '#22c55e' : 'var(--color-border)',
                                            flexShrink: 0,
                                            boxShadow: (entry as any).current
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
