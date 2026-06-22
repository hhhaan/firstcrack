import { useUpdatePlanBatch } from '@entities/plan';
import { useProfile } from '@entities/profile';
import { useCreateRoastSession } from '@entities/roast';
import { useResolvedProfileCurve, useRoastProfiles } from '@entities/roast-profile';
import {
    computePhaseSegments,
    formatTemp,
    toDisplayRoR,
    useRoastActions,
    useRoastKeyboardShortcuts,
    useRoastSettings,
} from '@features/active-roast';
import {
    CHART_GRID_RIGHT,
    CHART_GRID_RIGHT_WITH_ROR,
    EVENT_MARKER_COLORS,
} from '@features/active-roast/lib/chart-config';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import { useDeductRoastStock } from '@features/active-roast/model/useDeductRoastStock';
import { useRoastLog } from '@features/active-roast/model/useRoastLog';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { sidecar } from '@shared/lib/sidecar';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { useWeather } from '@views/dashboard/api/useWeather';
import { EndRoastModal } from './ui/EndRoastModal';
import { LiveReadings } from './ui/LiveReadings';
import { MachineControls } from './ui/MachineControls';
import { PlanBatchContinueModal } from './ui/PlanBatchContinueModal';
import type { RoastSummaryData } from './ui/RoastSummaryModal';
import { RoastSummaryModal } from './ui/RoastSummaryModal';
import { StockDeductModal } from '@widgets/stock-deduct-modal';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { extractVisibleControl, extractVisibleSeries, extractVisibleTarget } from './lib/chart-series';
import { buildEventMarkers, buildRoastLogDisplayEntries, calcDelta, calcDevTime } from './lib/display-derivatives';
import { formatElapsed } from './lib/format';
import { getRoastPhaseColor, getRoastPhaseName } from './lib/roast-phase';
import { CHART_TOTAL_SECS, useChartData } from './lib/useChartData';
import { useChartKeyboard } from './model/useChartKeyboard';
import { useChartZoom } from './model/useChartZoom';
import { useSidecarPolling } from './model/useSidecarPolling';
import { ChartLegend } from './ui/ChartLegend';
import { RoastHeader } from './ui/RoastHeader';
import { RoastSidePanel } from './ui/RoastSidePanel';
import { RoastTempChart } from './ui/RoastTempChart';

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
    const chargedRef = useRef(charged);
    // eslint-disable-next-line react-hooks/refs
    chargedRef.current = charged;
    const roastEnded = phase === 'ended';

    // ── 유저 + DB 프로파일 ────────────────────────────────────────
    const user = useAuthStore((s) => s.user);
    const { data: dbProfiles = [] } = useRoastProfiles(user?.id ?? '');
    const { data: userProfile } = useProfile(user?.id ?? '');

    // ── 배치 핸드오프 ─────────────────────────────────────────────
    const planBatchHandoff = useRoastSessionStore((s) => s.planBatchHandoff);
    const incrementCompletedSession = useRoastSessionStore((s) => s.incrementCompletedSession);
    const sessionsAfter = planBatchHandoff?.completedSessions ?? 0;
    const batchDone = planBatchHandoff ? sessionsAfter >= planBatchHandoff.batchCount : false;

    // ── UI 상태 ───────────────────────────────────────────────────
    const [targetProfileId, setTargetProfileId] = useState<string | null>(null);
    const userSelectedTargetRef = useRef(false);
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(null);
    const [handoffBeanName, setHandoffBeanName] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const isRunningRef = useRef(isRunning);
    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showEndRoastModal, setShowEndRoastModal] = useState(false);
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [summaryData, setSummaryData] = useState<RoastSummaryData | null>(null);
    const [noteInput, setNoteInput] = useState('');
    const [showContinueModal, setShowContinueModal] = useState(false);
    const [showDeductModal, setShowDeductModal] = useState(false);
    const [continueAfterDeduct, setContinueAfterDeduct] = useState(false);
    const [pendingStockDeduct, setPendingStockDeduct] = useState<{
        deductionGrams: number;
        singleBeanId: string | null;
        blendId: string | null;
        referenceId: string;
        beanName: string | null;
    } | null>(null);

    const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), []);
    const exitFullscreen = useCallback(() => setIsFullscreen(false), []);

    // 로그인 후 DB에서 기본 프로파일 ID를 가져와서 targetProfileId에 세팅.
    // charged 상태(로스팅 진행 중)에서는 절대 덮어쓰면 안 됨 → 로스팅 중 쿼리 refetch가 일어나도 선택 유지.
    // userProfile이 undefined이면 아직 로딩 중이므로 null로 덮어쓰는 오류 방지.
    // chargedRef: deps 배열에 charged 없이 최신 값을 읽어 stale closure 버그 방지.
    useEffect(() => {
        if (chargedRef.current || userSelectedTargetRef.current) return;
        if (userProfile !== undefined) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setTargetProfileId(userProfile?.default_roast_profile_id ?? null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userProfile?.default_roast_profile_id]);

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

    // planBatchHandoff가 설정되고 로스트 화면이 활성화될 때 bean/profile 적용
    useEffect(() => {
        if (!isActive || !planBatchHandoff) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (planBatchHandoff.beanId) setSelectedBeanId(planBatchHandoff.beanId);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHandoffBeanName(planBatchHandoff.beanName || null);
        if (planBatchHandoff.profileId) {
            userSelectedTargetRef.current = true;
            setTargetProfileId(planBatchHandoff.profileId);
        }
    }, [isActive, planBatchHandoff]);

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
    const { points: targetCurvePoints } = useResolvedProfileCurve(targetProfile);

    // charge 후: 실제 버퍼에 쌓인 구간과 설정값 중 짧은 쪽을 사용
    // (ready → charge 대기 시간이 설정값보다 짧으면 빈 공간 없이 딱 맞게)
    const actualPreSec =
        charged && livePoints.length > 0 && livePoints[0].time < 0 ? Math.ceil(Math.abs(livePoints[0].time)) : 0;
    const effectivePreChargeDisplaySec = charged ? Math.min(roastSettings.preChargeDisplaySec, actualPreSec) : 0;

    const { chartData, targetSeries } = useChartData({
        livePoints,
        targetCurvePoints,
        preChargeDisplaySec: effectivePreChargeDisplaySec,
    });
    /** 차트 x축 끝값. 데이터가 없으면 전체 범위로 고정 */
    const MAX_TIME = chartData.length > 0 ? chartData[chartData.length - 1].time : CHART_TOTAL_SECS;
    const MIN_TIME = -effectivePreChargeDisplaySec;
    const chartRightGridPad =
        roastSettings.showRoRChart || roastSettings.showControlChart ? CHART_GRID_RIGHT_WITH_ROR : CHART_GRID_RIGHT;

    // ── 차트 줌·패닝·드래그 ──────────────────────────────────────
    const {
        setZoomRange,
        effectiveZoomRange,
        hoveredChartIndexRef,
        setHoveredChartIndex,
        isChartDragging,
        mainChartHeight,
        chartAreaRef,
        handleChartWheel,
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
    } = useChartZoom(MAX_TIME, MIN_TIME, chartRightGridPad);

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

    const { visibleXs, visibleBtActual, visibleEtActual, visibleRorActual, visibleRorEtActual } = useMemo(
        () => extractVisibleSeries(visibleChartData, unit),
        [visibleChartData, unit],
    );

    const { visibleTargetXs, visibleTargetBt } = useMemo(() => {
        const points = effectiveZoomRange
            ? targetSeries.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
            : targetSeries;
        return extractVisibleTarget(points, unit);
    }, [targetSeries, effectiveZoomRange, unit]);

    const { visibleControlXs, visibleDrumTemp, visibleHeatPower, visibleFanSpeed } = useMemo(() => {
        const points = effectiveZoomRange
            ? livePoints.filter((p) => p.time >= effectiveZoomRange.start && p.time <= effectiveZoomRange.end)
            : livePoints;
        return extractVisibleControl(points);
    }, [livePoints, effectiveZoomRange]);

    // ── 차트 키보드 줌·패닝 ──────────────────────────────────────
    useChartKeyboard({
        isActive,
        isFullscreen,
        showEndRoastModal,
        showSummaryModal,
        minTime: MIN_TIME,
        maxTime: MAX_TIME,
        zoomRange: effectiveZoomRange,
        setZoomRange,
        visibleChartData,
        hoveredChartIndexRef,
    });

    const handleChartCursorIdx = useCallback(
        (idx: number | null) => {
            setHoveredChartIndex(idx);
        },
        [setHoveredChartIndex],
    );

    // 머신 disconnect 시 진행 중인 로스트를 초기화한다.
    useEffect(() => {
        if (sidecarConnected) return;
        if (phase === 'idle' || phase === 'ended') return;
        // eslint-disable-next-line react-hooks/immutability
        resetActiveRoast();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sidecarConnected]);

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

    // ── 실시간 파생값 ─────────────────────────────────────────────
    const rawBT = liveData?.bt ?? null;
    const rawET = liveData?.et ?? null;
    const timeStr = formatElapsed(elapsed);

    // ── 도메인 훅 ─────────────────────────────────────────────────
    const { logEntries, pressedButtons, markEvent, handleDrop, setLogEntries, removeLogEntry } = useRoastLog(
        unit,
        rawBT,
        timeStr,
    );

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
    const { mutateAsync: saveRoastSession, isPending: isSaving } = useCreateRoastSession(user?.id ?? '');
    const uploadRoastProfileTsv = useUploadRoastProfile();
    const { mutateAsync: updatePlanBatch } = useUpdatePlanBatch(planBatchHandoff?.planId ?? '');
    const deductRoastStock = useDeductRoastStock();

    const finishStockDeductFlow = useCallback(() => {
        setShowDeductModal(false);
        setPendingStockDeduct(null);
        if (continueAfterDeduct) {
            setContinueAfterDeduct(false);
            setShowContinueModal(true);
        }
    }, [continueAfterDeduct]);

    const handleStockDeductConfirm = useCallback(
        async (deductStock: boolean) => {
            if (deductStock && pendingStockDeduct) {
                await deductRoastStock({
                    deductionGrams: pendingStockDeduct.deductionGrams,
                    singleBeanId: pendingStockDeduct.singleBeanId,
                    blendId: pendingStockDeduct.blendId,
                    referenceId: pendingStockDeduct.referenceId,
                });
            }
            finishStockDeductFlow();
        },
        [pendingStockDeduct, deductRoastStock, finishStockDeductFlow],
    );

    useEffect(() => {
        tpTimeSecRef.current = turningPoints[0]?.timeSec ?? null;
    }, [turningPoints]);

    // ── 로스팅 단계 표시 ──────────────────────────────────────────
    const fcStartEntry = logEntries.find((e) => e.event === 'FC Start');

    const roastPhaseName = getRoastPhaseName(charged, phase, elapsed, logEntries);
    const roastPhaseColor = getRoastPhaseColor(charged, roastPhaseName);

    const eventMarkers = useMemo(() => buildEventMarkers(logEntries), [logEntries]);

    const phaseSegments = useMemo(
        () => (roastSettings.showPhaseBar ? computePhaseSegments(logEntries, elapsed, charged) : []),
        [roastSettings.showPhaseBar, logEntries, elapsed, charged],
    );

    const rawRoR = liveData?.ror ?? 0;
    const displayRoR = toDisplayRoR(rawRoR, unit).toFixed(1);

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

    // ── 표시용 파생값 ─────────────────────────────────────────────
    const { devTimeStr, dtrPct } = useMemo(() => calcDevTime(fcStartEntry, elapsed), [fcStartEntry, elapsed]);

    const { deltaBT, deltaET } = useMemo(() => calcDelta(livePoints, unit), [livePoints, unit]);

    const roastLogDisplayEntries = useMemo(
        () => buildRoastLogDisplayEntries(logEntries, roastEnded, charged, timeStr, rawBT, roastPhaseName, unit),
        [logEntries, roastEnded, charged, timeStr, rawBT, roastPhaseName, unit],
    );

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
        setShowSummaryModal(true);
    };

    const handleEndRoastClick = () => {
        if (roastEnded || !charged) return;
        setShowEndRoastModal(true);
    };

    const handleEventMarkerDrag = (event: string, newTimeSec: number) => {
        const newTimeStr = formatElapsed(newTimeSec);
        setLogEntries((prev) => prev.map((entry) => (entry.event === event ? { ...entry, time: newTimeStr } : entry)));
    };

    const handleMarkDrop = useCallback(() => {
        handleDrop();
    }, [handleDrop]);

    const handleNoteSubmit = useCallback(() => {
        if (!noteInput.trim()) return;
        markEvent('Note', noteInput.trim());
        setNoteInput('');
    }, [noteInput, markEvent]);

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
        onMarkDrop: handleMarkDrop,
    });

    // EndRoast 모달 Escape 닫기 (useRoastKeyboardShortcuts의 escape와 enabled 조건이 상호 배타적)
    useHotkeys(
        'escape',
        (e) => {
            e.preventDefault();
            setShowEndRoastModal(false);
        },
        { enabled: showEndRoastModal },
        [showEndRoastModal, setShowEndRoastModal],
    );

    const handleTargetProfileChange = useCallback((id: string | null) => {
        userSelectedTargetRef.current = true;
        setTargetProfileId(id);
    }, []);

    // ── 렌더 ──────────────────────────────────────────────────────
    return (
        <div className="px-[32px] py-[24px] flex flex-col gap-4 h-full min-h-0 overflow-hidden">
            <RoastHeader
                phase={roastPhaseName}
                targetProfileId={targetProfileId}
                selectedBeanId={selectedBeanId}
                fallbackBeanName={handoffBeanName}
                onTargetProfileChange={handleTargetProfileChange}
                onBeanChange={setSelectedBeanId}
                onOpenRoastSettings={onOpenRoastSettings}
            />

            {isFullscreen && (
                <LiveReadings
                    rawBT={rawBT}
                    rawET={rawET}
                    displayRoR={displayRoR}
                    unit={unit}
                    phase={roastPhaseName}
                    phaseColor={roastPhaseColor}
                    connected={sidecarConnected}
                />
            )}
            {isFullscreen && (
                <MachineControls
                    machineCapabilities={machineCapabilities}
                    sidecarConnected={sidecarConnected}
                    liveData={liveData}
                />
            )}

            {/* 온도 차트 */}
            <div
                className={`bg-(--color-roast-bg) flex flex-col min-h-0 overflow-hidden ${
                    isFullscreen
                        ? 'fixed inset-0 z-9999 h-screen w-screen p-10'
                        : 'rounded relative z-1 px-6 pb-4 pt-10 flex-1 dark:border dark:border-[#585d61]'
                }`}
            >
                <div className="flex gap-6 flex-1 min-h-0 flex-row">
                    {/* 차트 영역 — 휠·드래그·키보드로 줌/패닝 */}
                    <div
                        ref={chartAreaRef}
                        className={`relative flex-1 flex flex-col min-w-0 min-h-0 outline-none ${
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
                        role="region"
                        aria-label="Temperature curve chart. Use wheel or plus and minus to zoom, drag or use left and right arrows to pan, and 0 to reset zoom."
                    >
                        <ChartLegend
                            showTarget={!!targetProfileId && targetCurvePoints.length > 0}
                            targetLabel={targetProfile ? targetProfile.name : undefined}
                        />

                        <RoastTempChart
                            xs={visibleXs}
                            btTarget={[]}
                            targetXs={visibleTargetXs}
                            targetBt={visibleTargetBt}
                            btActual={visibleBtActual}
                            etActual={visibleEtActual}
                            rorActual={visibleRorActual}
                            currentTimeSec={elapsed}
                            eventMarkers={eventMarkers}
                            turningPoints={turningPoints}
                            height={mainChartHeight}
                            onCursorIdx={handleChartCursorIdx}
                            onEventMarkerDrag={handleEventMarkerDrag}
                            showET={roastSettings.showET}
                            showTargetCurve={
                                roastSettings.showTargetCurve && !!targetProfileId && targetCurvePoints.length > 0
                            }
                            showRoR={roastSettings.showRoRChart}
                            showRoRET={roastSettings.showRoRET}
                            rorEtActual={visibleRorEtActual}
                            temperatureUnit={unit}
                            controlData={
                                roastSettings.showControlChart
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

                    {/* 사이드 패널 — 수치 + 조작 + 로그 */}
                    <RoastSidePanel
                        rawBT={rawBT}
                        rawET={rawET}
                        displayRoR={displayRoR}
                        timeStr={timeStr}
                        unit={unit}
                        phase={phase}
                        charged={charged}
                        raostEnded={roastEnded}
                        deltaBT={deltaBT}
                        deltaET={deltaET}
                        dtrPct={dtrPct}
                        logEntries={logEntries}
                        pressedButtons={pressedButtons}
                        roastLogDisplayEntries={roastLogDisplayEntries}
                        noteInput={noteInput}
                        onNoteChange={setNoteInput}
                        onNoteSubmit={handleNoteSubmit}
                        onMarkEvent={markEvent}
                        onHandleDrop={handleDrop}
                        onRemoveLogEntry={removeLogEntry}
                        onEnterStandby={handleEnterStandby}
                        onManualCharge={handleManualCharge}
                        onEndRoast={handleEndRoastClick}
                    />
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
                eventMarkerColor={EVENT_MARKER_COLORS}
                isSaving={isSaving}
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
                onSave={async ({ notes, weightGrams: saveWeight, roastLevel: saveLevel }) => {
                    if (!user) return;
                    const durationSeconds = elapsed;
                    const roastedAt =
                        roastStartTimeRef.current > 0 ? new Date(roastStartTimeRef.current).toISOString() : null;

                    try {
                        let tsvPath: string | null = null;
                        if (sessionId) {
                            tsvPath = await uploadRoastProfileTsv(sessionId);
                        }

                        const savedSession = await saveRoastSession({
                            user_id: user.id,
                            weight_grams: saveWeight,
                            status: 'completed',
                            roasted_at: roastedAt,
                            duration_seconds: durationSeconds,
                            drop_temp_celsius: rawBT != null ? Math.round(rawBT) : null,
                            roast_level: saveLevel,
                            scheduled_at: null,
                            notes: notes || null,
                            ambient_temp_celsius: weatherData?.temperature ?? null,
                            ambient_humidity_pct: weatherData?.humidity ?? null,
                            bean_id: selectedBeanId,
                            profile_id: targetProfileId,
                            tsv_path: tsvPath,
                            plan_batch_id: planBatchHandoff?.planBatchId ?? null,
                        });
                        const deductionGrams = planBatchHandoff?.batchSizeKg
                            ? Math.round(planBatchHandoff.batchSizeKg * 1000)
                            : saveWeight > 0
                              ? saveWeight
                              : 0;
                        const blendId = planBatchHandoff?.blendId ?? null;
                        const canDeductStock = deductionGrams > 0 && Boolean(selectedBeanId || blendId);

                        const newCompletedCount = (planBatchHandoff?.completedSessions ?? 0) + 1;
                        const isNowBatchDone =
                            planBatchHandoff != null && newCompletedCount >= planBatchHandoff.batchCount;

                        incrementCompletedSession();

                        if (isNowBatchDone && planBatchHandoff) {
                            await updatePlanBatch({ id: planBatchHandoff.planBatchId, status: 'done' });
                        }
                        setShowSummaryModal(false);
                        setSummaryData(null);
                        resetActiveRoast();

                        if (canDeductStock) {
                            setPendingStockDeduct({
                                deductionGrams,
                                singleBeanId: selectedBeanId,
                                blendId,
                                referenceId: savedSession.id,
                                beanName: handoffBeanName ?? planBatchHandoff?.beanName ?? null,
                            });
                            setContinueAfterDeduct(!!planBatchHandoff);
                            setShowDeductModal(true);
                        } else if (planBatchHandoff) {
                            setShowContinueModal(true);
                        }
                    } catch (err) {
                        console.error('[RoastSummary] 저장 실패:', err);
                        await message(`저장에 실패했습니다.\n\n${err instanceof Error ? err.message : String(err)}`, {
                            title: '저장 실패',
                            kind: 'error',
                        });
                    }
                }}
            />

            <StockDeductModal
                open={showDeductModal}
                beanName={pendingStockDeduct?.beanName ?? undefined}
                deductionKg={((pendingStockDeduct?.deductionGrams ?? 0) / 1000).toFixed(1)}
                canDeduct={Boolean(pendingStockDeduct)}
                onClose={finishStockDeductFlow}
                onConfirm={handleStockDeductConfirm}
            />

            <PlanBatchContinueModal
                show={showContinueModal}
                planBatchHandoff={planBatchHandoff}
                batchDone={batchDone}
                sessionsAfter={sessionsAfter}
                onPlanBatchComplete={onPlanBatchComplete}
                onDismiss={() => setShowContinueModal(false)}
            />
        </div>
    );
};
