import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useWeather } from '@views/dashboard/useWeather';
import { useAuthStore } from '@shared/store/auth';
import { useCreateRoastSession } from '@entities/roast';
import { useRoastKeyboardShortcuts } from '@views/useRoastKeyboardShortcuts';
import { useRoastActions } from '@views/useRoastActions';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { readTextFile, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Play, Square } from 'lucide-react';
import { EndRoastModal } from '@widgets/active-roast/end-roast-modal/ui/EndRoastModal';
import { PageLayout } from '@shared/ui/PageLayout';
import {
    RoastSummaryModal,
    type RoastSummaryData,
} from '@widgets/active-roast/roast-summary-modal/ui/RoastSummaryModal';
import { RoastTempChart, type RoastEventMarker } from '@widgets/active-roast/ui/RoastTempChart';
import { EVENT_MARKER_COLORS } from '@features/active-roast/lib/chart-config';
import { PHASE_COLORS, SENSOR_COLORS } from '@features/active-roast/lib/colors';

import type { LogEntry } from '@shared/types/roast';
import { sidecar } from '@shared/lib/sidecar';
import { useRoastSettings, toDisplayTemp, toDisplayRoR, formatTemp, computePhaseSegments } from '@features/active-roast';

import { RoastHeader, LiveReadings, MachineControls, EventButtons, RoastLog } from '@widgets/active-roast';
import { ChartLegend } from '@widgets/active-roast/ui/ChartLegend';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import { useRoastLog } from '@features/active-roast/model/useRoastLog';
import { useRoastProfiles } from '@entities/roast-profile';
import { useCreateBeanInventoryLog } from '@entities/bean-inventory/queries';
import { useUpdatePlanBatch } from '@entities/plan';
import { useRoastSessionStore } from '@shared/store/roastSession';

import { useSidecarPolling } from './hooks/useSidecarPolling';
import { useChartData, CHART_TOTAL_SECS } from './hooks/useChartData';
import { useChartZoom, MIN_VISIBLE_SECS } from './hooks/useChartZoom';
import { parseTimeSec } from '@features/active-roast/lib/time';

export const ActiveRoast = ({
    isActive,
    onOpenRoastSettings,
    onPlanBatchComplete,
}: {
    isActive: boolean;
    onOpenRoastSettings?: () => void;
    onPlanBatchComplete?: () => void;
}) => {
    // ── 설정 ──────────────────────────────────────────────────────
    const roastSettings = useRoastSettings();
    const unit = roastSettings.temperatureUnit;

    // ── 스토어 구독 ───────────────────────────────────────────────
    const phase = useRoastingStore((s) => s.phase);
    const elapsed = useRoastingStore((s) => s.elapsed);
    const liveData = useRoastingStore((s) => s.liveData);
    const tick = useRoastingStore((s) => s.tick);
    const enterPreheating = useRoastingStore((s) => s.enterPreheating);
    const enterStandby = useRoastingStore((s) => s.enterStandby);
    const storeStartCharge = useRoastingStore((s) => s.startCharge);
    const storeEndRoast = useRoastingStore((s) => s.endRoast);
    const resetStore = useRoastingStore((s) => s.reset);
    const sessionId = useRoastingStore((s) => s.sessionId);
    const sidecarConnected = useRoastingStore((s) => s.sidecarConnected);
    const machineCapabilities = useRoastingStore((s) => s.machineCapabilities);
    const setConnected = useRoastingStore((s) => s.setConnected);

    const charged = phase === 'roasting' || phase === 'ended';
    const roastEnded = phase === 'ended';

    // ── 유저 + DB 프로파일 ────────────────────────────────────────
    const user = useAuthStore((s) => s.user);
    const { data: dbProfiles = [] } = useRoastProfiles(user?.id ?? '');

    // ── 배치 핸드오프 ─────────────────────────────────────────────
    const planBatchHandoff = useRoastSessionStore((s) => s.planBatchHandoff);
    const sessionsAfter = planBatchHandoff ? planBatchHandoff.completedSessions + 1 : 0;
    const batchDone = planBatchHandoff ? sessionsAfter >= planBatchHandoff.batchCount : false;

    // ── UI 상태 ───────────────────────────────────────────────────
    const [targetProfileId, setTargetProfileId] = useState<string | null>(() => {
        return localStorage.getItem('fc_default_profile_id');
    });
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const isRunningRef = useRef(isRunning);
    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showEndRoastModal, setShowEndRoastModal] = useState(false);
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [summaryData, setSummaryData] = useState<RoastSummaryData | null>(null);
    const [roastNotes, setRoastNotes] = useState('');
    const [showContinueModal, setShowContinueModal] = useState(false);

    const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), []);
    const exitFullscreen = useCallback(() => setIsFullscreen(false), []);

    // isActive가 true가 될 때마다 store의 pendingBeanId를 소비
    useEffect(() => {
        if (!isActive) return;
        const { pendingBeanId, setPendingBean } = useRoastingStore.getState();
        if (pendingBeanId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedBeanId(pendingBeanId);
            setPendingBean(null);
        }
    }, [isActive]);

    // planBatchHandoff 객체가 바뀔 때마다 bean/profile 적용 (같은 beanId여도 재발동)
    useEffect(() => {
        if (!planBatchHandoff) return;
        if (planBatchHandoff.beanId) setSelectedBeanId(planBatchHandoff.beanId);
        if (planBatchHandoff.profileId) setTargetProfileId(planBatchHandoff.profileId);
    }, [planBatchHandoff]);

    // ── 공유 ref (여러 훅·핸들러에서 참조) ───────────────────────
    /** Charge 순간의 Date.now() (ms). 0이면 로스팅 미시작 */
    const roastStartTimeRef = useRef(0);
    /** TP 확정 시각 (초). null이면 미확정 → RoR 미표시 */
    const tpTimeSecRef = useRef<number | null>(null);

    // ── 사이드카 폴링 및 실시간 데이터 ───────────────────────────
    const { livePoints, setLivePoints } = useSidecarPolling({
        isActive,
        phase,
        pollIntervalMs: roastSettings.pollIntervalMs,
        enterPreheating,
        setConnected,
        roastStartTimeRef,
        sessionId,
        preChargeDisplaySec: roastSettings.preChargeDisplaySec,
    });

    // ── 차트 데이터 파이프라인 ────────────────────────────────────
    const targetProfile = useMemo(
        () => dbProfiles.find((p) => p.id === targetProfileId) ?? null,
        [dbProfiles, targetProfileId],
    );
    // charge 후: 실제 버퍼에 쌓인 구간과 설정값 중 짧은 쪽을 사용
    // (ready → charge 대기 시간이 설정값보다 짧으면 빈 공간 없이 딱 맞게)
    const actualPreSec = charged && livePoints.length > 0 && livePoints[0].time < 0
        ? Math.ceil(Math.abs(livePoints[0].time))
        : 0;
    const effectivePreChargeDisplaySec = charged
        ? Math.min(roastSettings.preChargeDisplaySec, actualPreSec)
        : 0;

    const { chartData } = useChartData({
        livePoints,
        targetProfile,
        preChargeDisplaySec: effectivePreChargeDisplaySec,
    });
    /** 차트 x축 끝값. 데이터가 없으면 전체 범위로 고정 */
    const MAX_TIME = chartData.length > 0 ? chartData[chartData.length - 1].time : CHART_TOTAL_SECS;
    const MIN_TIME = -effectivePreChargeDisplaySec;

    // ── 차트 줌·패닝·드래그 ──────────────────────────────────────
    const {
        setZoomRange,
        effectiveZoomRange,
        hoveredChartIndex,
        setHoveredChartIndex,
        isChartDragging,
        mainChartHeight,
        chartAreaRef,
        handleChartWheel,
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
    } = useChartZoom(MAX_TIME, MIN_TIME);

    // fullscreen 진입 시 외부 줌 리셋 — ECharts 내부 zoom이 독립적으로 동작한다
    useEffect(() => {
        if (isFullscreen) setZoomRange(null);
    }, [isFullscreen, setZoomRange]);

    // ── 차트 가시 영역 데이터 ────────────────────────────────────
    const visibleChartData = useMemo(
        () =>
            effectiveZoomRange
                ? chartData.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
                : chartData,
        [chartData, effectiveZoomRange],
    );

    const { visibleXs, visibleBtTarget, visibleBtActual, visibleEtActual, visibleRorActual, visibleRorEtActual } = useMemo(() => {
        const xs: number[] = [];
        const btTarget: (number | null)[] = [];
        const btActual: (number | null)[] = [];
        const etActual: (number | null)[] = [];
        const rorActual: (number | null)[] = [];
        const rorEtActual: (number | null)[] = [];
        for (const p of visibleChartData) {
            xs.push(p.time);
            btTarget.push(p.btTarget != null ? toDisplayTemp(p.btTarget, unit) : null);
            btActual.push(p.btActual != null ? toDisplayTemp(p.btActual, unit) : null);
            etActual.push(p.etActual != null ? toDisplayTemp(p.etActual, unit) : null);
            rorActual.push(p.rorActual != null ? toDisplayRoR(p.rorActual, unit) : null);
            rorEtActual.push(p.etRorActual != null ? toDisplayRoR(p.etRorActual, unit) : null);
        }
        return {
            visibleXs: xs,
            visibleBtTarget: btTarget,
            visibleBtActual: btActual,
            visibleEtActual: etActual,
            visibleRorActual: rorActual,
            visibleRorEtActual: rorEtActual,
        };
    }, [visibleChartData, unit]);

    const { visibleControlXs, visibleDrumTemp, visibleHeatPower, visibleFanSpeed } = useMemo(() => {
        const points = effectiveZoomRange
            ? livePoints.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
            : livePoints;
        return {
            visibleControlXs: points.map((p) => p.time),
            visibleDrumTemp: points.map((p) => p.drum),
            visibleHeatPower: points.map((p) => p.heater),
            visibleFanSpeed: points.map((p) => p.fan),
        };
    }, [livePoints, effectiveZoomRange]);

    // ── 키보드 줌·패닝 (visibleChartData 참조로 인해 훅으로 분리 불가) ──
    const zoomChart = (zoomFactor: number) => {
        if (MAX_TIME <= 0) return;
        const currentStart = effectiveZoomRange?.start ?? MIN_TIME;
        const currentEnd = effectiveZoomRange?.end ?? MAX_TIME;
        const currentDuration = currentEnd - currentStart;
        const nextDuration = Math.max(MIN_VISIBLE_SECS, Math.min(MAX_TIME - MIN_TIME, currentDuration * zoomFactor));
        if (nextDuration >= MAX_TIME - MIN_TIME) {
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
        if (nextStart < MIN_TIME) {
            nextStart = MIN_TIME;
            nextEnd = MIN_TIME + nextDuration;
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
        const nextStart = Math.max(MIN_TIME, Math.min(MAX_TIME - duration, effectiveZoomRange.start + step * direction));
        setZoomRange({ start: nextStart, end: nextStart + duration });
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

    // ── 타이머 ────────────────────────────────────────────────────
    useEffect(() => {
        if (!isRunning) return;
        const interval = setInterval(() => tick(), 1000);
        return () => clearInterval(interval);
    }, [isRunning, tick]);

    // 로스팅 중 창 닫기 시 확인 다이얼로그를 표시한다.
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
            if (active) {
                unlisten = fn;
            } else {
                fn();
            }
        });
        return () => {
            active = false;
            unlisten?.();
        };
    }, []);

    // EndRoast 모달이 열려 있을 때 Escape로 닫는다.
    useEffect(() => {
        if (!showEndRoastModal) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isActive) return;
            if (event.key === 'Escape') setShowEndRoastModal(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, showEndRoastModal]);

    // ── 실시간 파생값 ─────────────────────────────────────────────
    const rawBT = liveData?.bt ?? null;
    const rawET = liveData?.et ?? null;
    const elapsedMin = Math.floor(elapsed / 60);
    const elapsedSec = elapsed % 60;
    const timeStr = `${elapsedMin}:${String(elapsedSec).padStart(2, '0')}`;

    // ── 도메인 훅 ─────────────────────────────────────────────────
    const { logEntries, pressedButtons, markEvent, handleDrop, setLogEntries } = useRoastLog(unit, rawBT, timeStr);

    const { triggerCharge, handleAutoDrop, handleTurningPoint } = useRoastActions({
        unit,
        rawBT,
        setLogEntries,
        setIsRunning,
        setShowEndRoastModal,
        storeStartCharge,
        roastStartTimeRef,
    });

    const { turningPoints, resetAutoDetection, disableAutoCharge } = useAutoDetection(
        livePoints,
        triggerCharge,
        handleAutoDrop,
        handleTurningPoint,
        roastSettings.autoChargeDropC,
    );

    // ── 날씨 데이터 ───────────────────────────────────────────────
    const { data: weatherData } = useWeather();

    // ── 사용자 인증 + 로스팅 저장 ─────────────────────────────────
    const { mutateAsync: saveRoastSession } = useCreateRoastSession(user?.id ?? '');
    const { mutateAsync: createInventoryLog } = useCreateBeanInventoryLog(user?.id ?? '');
    const { mutateAsync: updatePlanBatch } = useUpdatePlanBatch(planBatchHandoff?.planId ?? '');
    useEffect(() => {
        tpTimeSecRef.current = turningPoints[0]?.timeSec ?? null;
    }, [turningPoints]);

    // ── 로스팅 단계 표시 ──────────────────────────────────────────
    const fcStartEntry = logEntries.find((e) => e.event === 'FC Start');
    const yellowEntry = logEntries.find((e) => e.event === 'Yellow');

    /** 이벤트 로그 기반으로 현재 로스팅 단계 이름을 결정한다 */
    const roastPhaseName = (() => {
        if (!charged) {
            switch (phase) {
                case 'standby':
                    return 'READY';
                case 'preheating':
                    return 'PREHEATING';
                case 'idle':
                    return 'IDLE';
                default:
                    return phase;
            }
        }
        if (fcStartEntry && elapsed >= parseTimeSec(fcStartEntry.time)) return 'Development';
        if (yellowEntry && elapsed >= parseTimeSec(yellowEntry.time)) return 'Maillard';
        return 'Drying';
    })();

    const roastPhaseColor = !charged
        ? PHASE_COLORS.ready
        : roastPhaseName === 'Development'
          ? PHASE_COLORS.development
          : roastPhaseName === 'Maillard'
            ? PHASE_COLORS.maillard
            : PHASE_COLORS.drying;

    const eventMarkers = useMemo(
        (): RoastEventMarker[] =>
            logEntries
                .filter((e) => EVENT_MARKER_COLORS[e.event] && e.event !== 'TP')
                .map((e) => {
                    const [min, sec] = e.time.split(':').map(Number);
                    const timeSec = Math.max(0, min * 60 + sec);
                    return { timeSec, event: e.event, color: EVENT_MARKER_COLORS[e.event] };
                }),
        [logEntries],
    );

    const phaseSegments = useMemo(
        () =>
            roastSettings.showPhaseBar
                ? computePhaseSegments(logEntries, elapsed, charged)
                : [],
        [roastSettings.showPhaseBar, logEntries, elapsed, charged],
    );

    const rawRoR = liveData?.ror ?? 0;
    const displayRoR = rawRoR < 0 ? '—' : toDisplayRoR(rawRoR, unit).toFixed(1);

    // ── 로스트 라이프사이클 핸들러 ────────────────────────────────

    /** Phase 2(preheating) → standby: 사용자가 로스팅 준비 완료를 확인 */
    const handleEnterStandby = useCallback(() => {
        if (phase !== 'preheating') return;
        enterStandby();
        // 가상 머신에 standby 진입 알림 — 생두 투입 시뮬레이션 트리거
        sidecar.enterStandby().catch(() => {});
    }, [phase, enterStandby]);

    /** Phase standby → roasting: 수동 Charge 버튼 */
    const handleManualCharge = useCallback(async () => {
        if (charged) return;
        const status = await sidecar.getStatus().catch(() => null);
        if (!status?.connected) {
            setConnected(false);
            if ('__TAURI_INTERNALS__' in window) {
                await message('머신이 연결되어 있지 않습니다.', { title: '머신 연결 필요', kind: 'warning' });
            }
            return;
        }
        disableAutoCharge();
        triggerCharge(rawBT);
    }, [charged, rawBT, triggerCharge, setConnected, disableAutoCharge]);

    /** 로스팅을 처음 상태로 되돌린다. 사이드카가 연결되어 있으면 예열 단계로 재진입 */
    const resetActiveRoast = () => {
        roastStartTimeRef.current = 0;
        resetAutoDetection();
        setIsRunning(false);
        resetStore();
        if (sidecarConnected) {
            sidecar.resetRoast().catch(() => {});
            enterPreheating();
        }
        setLogEntries([]);
        setLivePoints([]);
        setZoomRange(null);
        setHoveredChartIndex(null);
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
        storeEndRoast();
        setIsRunning(false);
        setShowEndRoastModal(false);
        setRoastNotes('');
        setShowSummaryModal(true);
    };

    const handleEndRoastClick = () => {
        if (roastEnded || !charged) return;
        setShowEndRoastModal(true);
    };

    const handleEventMarkerDrag = (event: string, newTimeSec: number) => {
        const newMin = Math.floor(newTimeSec / 60);
        const newSec = Math.floor(newTimeSec % 60);
        const newTimeStr = `${newMin}:${String(newSec).padStart(2, '0')}`;
        setLogEntries((prev) => prev.map((entry) => (entry.event === event ? { ...entry, time: newTimeStr } : entry)));
    };

    useRoastKeyboardShortcuts({
        isActive,
        isFullscreen,
        showEndRoastModal,
        showSummaryModal,
        phase,
        onToggleFullscreen: toggleFullscreen,
        onExitFullscreen: exitFullscreen,
        onEnterStandby: handleEnterStandby,
        onManualCharge: handleManualCharge,
        onMarkEvent: markEvent,
    });

    // ── 표시용 파생값 ─────────────────────────────────────────────

    const { devTimeStr, dtrPct } = useMemo(() => {
        if (!fcStartEntry || elapsed === 0) return { devTimeStr: '—', dtrPct: null };
        const devSec = elapsed - parseTimeSec(fcStartEntry.time);
        if (devSec <= 0) return { devTimeStr: '—', dtrPct: null };
        const pct = Math.round((devSec / elapsed) * 100);
        return {
            devTimeStr: `${Math.floor(devSec / 60)}:${String(devSec % 60).padStart(2, '0')} (${pct}%)`,
            dtrPct: pct,
        };
    }, [fcStartEntry, elapsed]);

    /** ΔBT, ΔET — 30초 전 대비 현재 온도 변화량 (pre-charge 포인트 제외) */
    const { deltaBT, deltaET } = useMemo(() => {
        const postChargePoints = livePoints.filter((p) => p.time >= 0);
        if (postChargePoints.length < 2) return { deltaBT: null, deltaET: null };
        const current = postChargePoints[postChargePoints.length - 1];
        const targetTime = current.time - 30;
        const past = postChargePoints.reduce((prev, curr) =>
            Math.abs(curr.time - targetTime) < Math.abs(prev.time - targetTime) ? curr : prev,
        );
        if (past === current) return { deltaBT: null, deltaET: null };
        const dbt = toDisplayTemp(current.bt, unit) - toDisplayTemp(past.bt, unit);
        const det =
            current.et != null && past.et != null
                ? toDisplayTemp(current.et, unit) - toDisplayTemp(past.et, unit)
                : null;
        return {
            deltaBT: dbt.toFixed(1),
            deltaET: det != null ? det.toFixed(1) : null,
        };
    }, [livePoints, unit]);

    const roastLogDisplayEntries = useMemo((): LogEntry[] => {
        const sorted = [...logEntries].sort((a, b) => parseTimeSec(a.time) - parseTimeSec(b.time));
        return [
            ...sorted,
            ...(!roastEnded && charged
                ? [
                      {
                          time: timeStr,
                          event: 'Now',
                          temp: formatTemp(rawBT, unit),
                          note: `${roastPhaseName} in progress`,
                          current: true,
                      },
                  ]
                : []),
        ];
    }, [logEntries, roastEnded, charged, timeStr, rawBT, roastPhaseName, unit]);

    // ── 렌더 ──────────────────────────────────────────────────────
    return (
        <PageLayout>
            <RoastHeader
                phase={roastPhaseName}
                targetProfileId={targetProfileId}
                selectedBeanId={selectedBeanId}
                onTargetProfileChange={setTargetProfileId}
                onBeanChange={setSelectedBeanId}
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

            {/* 온도 차트 */}
            <div
                className={`bg-(--color-roast-bg) flex flex-col mb-5 ${
                    isFullscreen
                        ? 'rounded-none fixed inset-0 z-9999 h-screen w-screen p-10'
                        : 'rounded-lg relative z-1 border border-[#E5E5E5] px-6 pb-4 pt-6'
                }`}
            >
                <div className={`flex gap-6 flex-1 min-h-0 ${isFullscreen ? 'flex-row' : 'flex-col'}`}>
                    {/* 차트 영역 — 휠·드래그·키보드로 줌/패닝 */}
                    <div
                        ref={chartAreaRef}
                        className={`relative flex-1 flex flex-col min-w-0 outline-none ${
                            effectiveZoomRange
                                ? isChartDragging
                                    ? 'cursor-grabbing select-none touch-none'
                                    : 'cursor-grab touch-none'
                                : 'cursor-default'
                        }`}
                        onWheel={isFullscreen ? undefined : handleChartWheel}
                        onPointerDown={isFullscreen ? undefined : handleChartPointerDown}
                        onPointerMove={isFullscreen ? undefined : handleChartPointerMove}
                        onPointerUp={isFullscreen ? undefined : endChartDrag}
                        onPointerCancel={isFullscreen ? undefined : endChartDrag}
                        onKeyDown={isFullscreen ? undefined : handleChartKeyDown}
                        tabIndex={0}
                        role="region"
                        aria-label="Temperature curve chart. Use wheel or plus and minus to zoom, drag or use left and right arrows to pan, and 0 to reset zoom."
                    >
                        <ChartLegend />

                        {/* 이벤트 기반 단계 표시 pill */}
                        <div className="flex gap-2 mb-3">
                            {[
                                { label: 'Drying', active: roastPhaseName === 'Drying' && charged },
                                { label: 'Maillard', active: roastPhaseName === 'Maillard' },
                                { label: 'Development', active: roastPhaseName === 'Development' },
                            ].map(({ label, active }) => (
                                <div
                                    key={label}
                                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium tracking-[0.3px] transition-all duration-300 ${
                                        active
                                            ? 'bg-primary text-white'
                                            : 'bg-surface text-muted'
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
                            showRoRET={roastSettings.showRoRET}
                            rorEtActual={visibleRorEtActual}
                            temperatureUnit={unit}
                            controlData={
                                isFullscreen && roastSettings.showControlChart
                                    ? {
                                          xs: visibleControlXs,
                                          drumTemp: visibleDrumTemp,
                                          heatPower: visibleHeatPower,
                                          fanSpeed: visibleFanSpeed,
                                      }
                                    : undefined
                            }
                            phaseSegments={phaseSegments}
                        />
                    </div>

                    {/* 풀스크린 전용 사이드 패널 — 수치 + 조작 버튼 */}
                    {isFullscreen && (
                        <div className="w-56 flex flex-col gap-4 px-4 pb-5 border-l border-border-subtle overflow-hidden">
                            <div className="grid grid-cols-1 gap-3">
                                {/* BT */}
                                <div className="text-right">
                                    <div className="text-sm text-muted font-semibold uppercase mb-1">BT</div>
                                    <div
                                        className="font-mono text-4xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                                        style={{ color: SENSOR_COLORS.bt }}
                                    >
                                        {formatTemp(rawBT, unit)}
                                    </div>
                                </div>
                                {/* ΔBT */}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted font-semibold uppercase">ΔBT (30s)</span>
                                    <span
                                        className="font-mono text-2xl font-medium leading-tight"
                                        style={{ color: SENSOR_COLORS.bt }}
                                    >
                                        {deltaBT != null ? `${Number(deltaBT) >= 0 ? '+' : ''}${deltaBT}°` : '—'}
                                    </span>
                                </div>
                                {/* ET */}
                                <div className="text-right border-t border-border-subtle pt-3">
                                    <div className="text-sm text-muted font-semibold uppercase mb-1">ET</div>
                                    <div
                                        className="font-mono text-4xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                                        style={{ color: SENSOR_COLORS.et }}
                                    >
                                        {formatTemp(rawET, unit)}
                                    </div>
                                </div>
                                {/* ΔET */}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted font-semibold uppercase">ΔET (30s)</span>
                                    <span
                                        className="font-mono text-2xl font-medium leading-tight"
                                        style={{ color: SENSOR_COLORS.et }}
                                    >
                                        {deltaET != null ? `${Number(deltaET) >= 0 ? '+' : ''}${deltaET}°` : '—'}
                                    </span>
                                </div>
                                {/* RoR */}
                                <div className="text-right border-t border-border-subtle pt-3">
                                    <div className="text-sm text-muted font-semibold uppercase mb-1">RoR</div>
                                    <div
                                        className="font-mono text-4xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                                        style={{ color: SENSOR_COLORS.ror }}
                                    >
                                        {displayRoR}
                                    </div>
                                </div>
                                {/* Time */}
                                <div className="text-right border-t border-border-subtle pt-3">
                                    <div className="text-sm text-muted font-semibold uppercase mb-1">Time</div>
                                    <div
                                        className="font-mono text-4xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                                        style={{ color: 'var(--color-primary)' }}
                                    >
                                        {timeStr}
                                    </div>
                                </div>
                                {/* DTR */}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted font-semibold uppercase">DTR</span>
                                    <span
                                        className="font-mono text-2xl font-medium leading-tight"
                                        style={{ color: PHASE_COLORS.development }}
                                    >
                                        {dtrPct != null ? `${dtrPct}%` : '—'}
                                    </span>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-col gap-1.5">
                                    {phase === 'preheating' && (
                                        <button
                                            onClick={handleEnterStandby}
                                            className="flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer"
                                        >
                                            <Play size={12} />
                                            Roast Ready
                                        </button>
                                    )}
                                    {phase === 'standby' && (
                                        <button
                                            onClick={handleManualCharge}
                                            className="flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer"
                                        >
                                            <Play size={12} />
                                            Charge
                                        </button>
                                    )}
                                    <button
                                        onClick={handleEndRoastClick}
                                        disabled={roastEnded || !charged}
                                        aria-label="End roast"
                                        className={`flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold ${
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
                                        {
                                            label: 'Mark Drop',
                                            event: 'Drop',
                                            shortcut: '⌘D',
                                            pressKey: 'Mark Drop',
                                            onClick: handleDrop,
                                        },
                                    ]}
                                />
                            </div>
                            <RoastLog
                                variant="sidebar"
                                entries={roastLogDisplayEntries}
                                eventMarkerColor={EVENT_MARKER_COLORS}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* 컨트롤 + 로그 행 */}
            <div className="grid grid-cols-2 gap-5">
                <div className="bg-main-bg rounded-lg px-6 py-5 border border-[#E5E5E5]">
                    <h3 className="text-sm font-medium text-primary tracking-[0.14px] mb-4">Roast Controls</h3>
                    <div className="flex gap-2.5 mb-5">
                        {phase === 'preheating' && (
                            <button
                                onClick={handleEnterStandby}
                                aria-keyshortcuts="Meta+Enter Control+Enter"
                                className="flex-1 flex items-center justify-center gap-2 py-2.75 rounded-md border-none text-sm font-medium tracking-[0.14px] bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer"
                            >
                                <Play size={15} strokeWidth={2} />
                                READY
                            </button>
                        )}
                        {phase === 'standby' && (
                            <button
                                onClick={handleManualCharge}
                                aria-keyshortcuts="Meta+Enter Control+Enter"
                                className="flex-1 flex items-center justify-center gap-2 py-2.75 rounded-md border-none text-sm font-medium tracking-[0.14px] bg-[rgba(220,252,231,0.8)] text-[#16a34a] cursor-pointer"
                            >
                                <Play size={15} strokeWidth={2} />
                                Charge
                            </button>
                        )}
                        {(phase === 'roasting' || phase === 'ended') && (
                            <button
                                disabled={true}
                                className="flex-1 flex items-center justify-center gap-2 py-2.75 rounded-md border-none text-sm font-medium tracking-[0.14px] bg-surface text-muted cursor-default"
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
                                    ? 'bg-surface text-muted cursor-default'
                                    : 'bg-[rgba(254,226,226,0.8)] text-[#dc2626] cursor-pointer'
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
                                label: 'Mark Drop',
                                event: 'Drop',
                                shortcut: '⌘D',
                                pressKey: 'Mark Drop',
                                onClick: handleDrop,
                            },
                        ]}
                    />
                </div>

                <div className="bg-main-bg rounded-lg px-6 py-5 border border-[#E5E5E5]">
                    <h3 className="text-sm font-medium text-primary tracking-[0.14px] mb-3.5">Roast Log</h3>
                    <RoastLog variant="main" entries={roastLogDisplayEntries} eventMarkerColor={EVENT_MARKER_COLORS} />
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
                eventMarkerColor={EVENT_MARKER_COLORS}
                onRoastNotesChange={setRoastNotes}
                ambientTemp={weatherData?.temperature}
                ambientHumidity={weatherData?.humidity}
                onClose={() => {
                    setShowSummaryModal(false);
                    setSummaryData(null);
                }}
                onDiscard={() => {
                    setShowSummaryModal(false);
                    setSummaryData(null);
                    resetActiveRoast();
                }}
                onSave={async (notes) => {
                    if (!user) return;
                    const durationSeconds = elapsed;
                    const roastedAt =
                        roastStartTimeRef.current > 0 ? new Date(roastStartTimeRef.current).toISOString() : null;

                    // TSV 파일을 Cloudflare R2에 업로드한다.
                    let tsvPath: string | null = null;
                    if (sessionId && '__TAURI_INTERNALS__' in window) {
                        try {
                            const tsvContent = await readTextFile(`session_${sessionId}.tsv`, {
                                baseDir: BaseDirectory.AppLocalData,
                            });
                            const r2Key = `profiles/${user.id}/${sessionId}.tsv`;
                            const r2 = new S3Client({
                                region: 'auto',
                                endpoint: `https://${import.meta.env.VITE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
                                credentials: {
                                    accessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID,
                                    secretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY,
                                },
                            });
                            await r2.send(
                                new PutObjectCommand({
                                    Bucket: import.meta.env.VITE_R2_BUCKET_NAME,
                                    Key: r2Key,
                                    Body: tsvContent,
                                    ContentType: 'text/tab-separated-values',
                                }),
                            );
                            tsvPath = r2Key;
                            remove(`session_${sessionId}.tsv`, {
                                baseDir: BaseDirectory.AppLocalData,
                            }).catch(() => {});
                        } catch {
                            // 파일이 없거나 업로드 실패 시 tsv_path 없이 저장 진행
                        }
                    }

                    const savedSession = await saveRoastSession({
                        user_id: user.id,
                        weight_grams: 0, // TODO: UI에서 로스트 전 또는 후 무게 입력받기
                        status: 'completed',
                        roasted_at: roastedAt,
                        duration_seconds: durationSeconds,
                        drop_temp_celsius: rawBT,
                        roast_level: null, // TODO: UI에서 로스트 레벨(light/medium/dark) 선택받기
                        scheduled_at: null,
                        notes: notes || null,
                        ambient_temp_celsius: weatherData?.temperature ?? null,
                        ambient_humidity_pct: weatherData?.humidity ?? null,
                        bean_id: selectedBeanId,
                        profile_id: targetProfileId,
                        tsv_path: tsvPath,
                        plan_batch_id: planBatchHandoff?.planBatchId ?? null,
                    });
                    if (selectedBeanId && planBatchHandoff?.batchSizeKg && user) {
                        await createInventoryLog({
                            user_id: user.id,
                            bean_id: selectedBeanId,
                            change_grams: -Math.round(planBatchHandoff.batchSizeKg * 1000),
                            type: 'roast',
                            roast_session_id: savedSession.id,
                        });
                    }
                    // TODO: 일반 로스팅(배치 없음) 시에도 생두 재고 감소 처리 필요.
                    //       weight_grams UI 입력 기능 구현 후 여기서 createInventoryLog 호출 추가.

                    // 배치의 모든 세션이 완료되면 status를 'done'으로 업데이트한다.
                    if (batchDone && planBatchHandoff) {
                        await updatePlanBatch({ id: planBatchHandoff.planBatchId, status: 'done' });
                    }
                    setShowSummaryModal(false);
                    setSummaryData(null);
                    resetActiveRoast();
                    if (planBatchHandoff) {
                        setShowContinueModal(true);
                    }
                }}
            />

            {/* Plan batch continue modal */}
            {showContinueModal && planBatchHandoff && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.18)] border border-black/8 p-8 w-[360px] flex flex-col gap-5">
                        <div>
                            <p className="text-[15px] font-semibold text-primary">
                                {planBatchHandoff.beanName}
                            </p>
                            <p className="text-[13px] text-secondary mt-1">
                                {batchDone
                                    ? `배치 완료 (${sessionsAfter}/${planBatchHandoff.batchCount})`
                                    : `세션 ${sessionsAfter}/${planBatchHandoff.batchCount} 완료. 다음 세션을 진행할까요?`}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setShowContinueModal(false);
                                    onPlanBatchComplete?.();
                                }}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-surface text-secondary text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors"
                            >
                                {batchDone ? '일정으로 돌아가기' : '오늘은 여기까지'}
                            </button>
                            {!batchDone && (
                                <button
                                    onClick={() => setShowContinueModal(false)}
                                    className="flex-1 px-4 py-2.5 rounded-xl border-none bg-primary text-white text-[13px] font-semibold cursor-pointer hover:opacity-90 transition-opacity"
                                >
                                    다음 세션 시작
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </PageLayout>
    );
};
