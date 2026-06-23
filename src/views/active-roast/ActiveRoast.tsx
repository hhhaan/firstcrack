import { useProfile } from '@entities/profile';
import { useResolvedProfileCurve, useRoastProfiles } from '@entities/roast-profile';
import {
    computePhaseSegments,
    toDisplayRoR,
    useRoastActions,
    useRoastKeyboardShortcuts,
    useRoastSettings,
} from '@features/active-roast';
import { EVENT_MARKER_COLORS } from '@features/active-roast/lib/chart-config';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import { useRoastLog } from '@features/active-roast/model/useRoastLog';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { useWeather } from '@views/dashboard/api/useWeather';
import { StockDeductModal } from '@widgets/stock-deduct-modal';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useShallow } from 'zustand/react/shallow';
import { buildEventMarkers, buildRoastLogDisplayEntries, calcDelta, calcDevTime } from './lib/display-derivatives';
import { formatElapsed } from './lib/format';
import { getRoastPhaseColor, getRoastPhaseName } from './lib/roast-phase';
import { useChartKeyboard } from './model/useChartKeyboard';
import { useChartPipeline } from './model/useChartPipeline';
import { useRoastLifecycle } from './model/useRoastLifecycle';
import { useRoastProfileSelection } from './model/useRoastProfileSelection';
import { useRoastSaveFlow } from './model/useRoastSaveFlow';
import { useSidecarPolling } from './model/useSidecarPolling';
import { EndRoastModal } from './ui/EndRoastModal';
import { LiveReadings } from './ui/LiveReadings';
import { MachineControls } from './ui/MachineControls';
import { PlanBatchContinueModal } from './ui/PlanBatchContinueModal';
import { RoastChartContainer } from './ui/RoastChartContainer';
import { RoastHeader } from './ui/RoastHeader';
import { RoastSidePanel } from './ui/RoastSidePanel';
import { RoastSummaryModal } from './ui/RoastSummaryModal';

interface ActiveRoastProps {
    isActive: boolean;
    onOpenRoastSettings?: () => void;
    onPlanBatchComplete?: () => void;
}

export const ActiveRoast = ({ isActive, onOpenRoastSettings, onPlanBatchComplete }: ActiveRoastProps) => {
    // ── 설정 ──────────────────────────────────────────────────────
    const roastSettings = useRoastSettings();
    const unit = roastSettings.temperatureUnit;

    // ── 스토어 구독 ───────────────────────────────────────────────
    const { phase, elapsed, liveData, tick, sessionId, sidecarConnected, machineCapabilities } = useRoastingStore(
        useShallow((s) => ({
            phase: s.phase,
            elapsed: s.elapsed,
            liveData: s.liveData,
            tick: s.tick,
            sessionId: s.sessionId,
            sidecarConnected: s.sidecarConnected,
            machineCapabilities: s.machineCapabilities,
        })),
    );
    const storeActions = useRoastingStore.getState();
    const {
        enterPreheating,
        enterStandby,
        startCharge: storeStartCharge,
        endRoast: storeEndRoast,
        reset: resetStore,
        setConnected,
    } = storeActions;

    const charged = phase === 'roasting' || phase === 'ended';
    const roastEnded = phase === 'ended';

    // ── 유저 + DB 프로파일 ────────────────────────────────────────
    const user = useAuthStore((s) => s.user);
    const { data: dbProfiles = [] } = useRoastProfiles(user?.id ?? '');
    const { data: userProfile } = useProfile(user?.id ?? '');

    // ── 배치 핸드오프 ─────────────────────────────────────────────
    const planBatchHandoff = useRoastSessionStore((s) => s.planBatchHandoff);
    const sessionsAfter = planBatchHandoff?.completedSessions ?? 0;
    const batchDone = planBatchHandoff ? sessionsAfter >= planBatchHandoff.batchCount : false;

    // ── 프로파일/원두 선택 ─────────────────────────────────────────
    const { targetProfileId, selectedBeanId, setSelectedBeanId, handoffBeanName, setUserSelectedTarget } =
        useRoastProfileSelection({ isActive, charged, userProfile });

    // ── UI 상태 ───────────────────────────────────────────────────
    const [isRunning, setIsRunning] = useState(false);
    const isRunningRef = useRef(isRunning);
    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), []);
    const exitFullscreen = useCallback(() => setIsFullscreen(false), []);

    // ── 공유 ref ──────────────────────────────────────────────────
    const roastStartTimeRef = useRef(0);

    // ── 사이드카 폴림 및 실시간 데이터 ───────────────────────────
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

    // ── 차트 데이터 준비 ──────────────────────────────────────────
    const targetProfile = useMemo(
        () => dbProfiles.find((p) => p.id === targetProfileId) ?? null,
        [dbProfiles, targetProfileId],
    );
    const { points: targetCurvePoints } = useResolvedProfileCurve(targetProfile);

    const actualPreSec =
        charged && livePoints.length > 0 && livePoints[0].time < 0 ? Math.ceil(Math.abs(livePoints[0].time)) : 0;
    const effectivePreChargeDisplaySec = charged ? Math.min(roastSettings.preChargeDisplaySec, actualPreSec) : 0;

    // ── 차트 데이터 파이프라인 ────────────────────────────────────
    const chart = useChartPipeline({
        livePoints,
        targetCurvePoints,
        preChargeDisplaySec: effectivePreChargeDisplaySec,
        showRoR: roastSettings.showRoRChart,
        showControlChart: roastSettings.showControlChart,
        unit,
        isFullscreen,
    });

    // ── 도메인 훅 ─────────────────────────────────────────────────
    const rawBT = liveData?.bt ?? null;
    const rawET = liveData?.et ?? null;
    const timeStr = formatElapsed(elapsed);

    const { logEntries, pressedButtons, markEvent, handleDrop, setLogEntries, removeLogEntry } = useRoastLog(
        unit,
        rawBT,
        timeStr,
    );

    const fcStartEntry = logEntries.find((e) => e.event === 'FC Start');
    const { devTimeStr, dtrPct } = useMemo(() => calcDevTime(fcStartEntry, elapsed), [fcStartEntry, elapsed]);

    // 라이프사이클과 하위 훅 사이 순환 의존성을 refs로 분리
    const resetAutoDetectionRef = useRef<() => void>(() => {});
    const disableAutoChargeRef = useRef<() => void>(() => {});
    const triggerChargeRef = useRef<(bt?: number | null) => void>(() => {});

    const lifecycle = useRoastLifecycle({
        phase,
        charged,
        sidecarConnected,
        rawBT,
        unit,
        logEntries,
        timeStr,
        devTimeStr,
        enterStandby,
        enterPreheating,
        storeEndRoast,
        setConnected,
        setIsRunning,
        resetStore,
        resetAutoDetectionRef,
        disableAutoChargeRef,
        setLogEntries,
        setLivePoints,
        setZoomRange: chart.setZoomRange,
        setHoveredChartIndex: chart.setHoveredChartIndex,
        triggerChargeRef,
        roastStartTimeRef,
    });

    // ── 날씨 데이터 ───────────────────────────────────────────────
    const { data: weatherData } = useWeather();

    // ── 모달/저장 플로우 ──────────────────────────────────────────
    const saveFlow = useRoastSaveFlow({
        planBatchHandoff,
        elapsed,
        roastStartTimeRef,
        rawBT,
        selectedBeanId,
        targetProfileId,
        handoffBeanName,
        sessionId,
        ambientTemperature: weatherData?.temperature,
        ambientHumidity: weatherData?.humidity,
        onResetActiveRoast: lifecycle.resetActiveRoast,
    });

    const { triggerCharge, handleAutoDrop, handleTurningPoint } = useRoastActions({
        unit,
        rawBT,
        setLogEntries,
        setIsRunning,
        setShowEndRoastModal: saveFlow.flow.openEndRoast,
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

    useEffect(() => {
        resetAutoDetectionRef.current = resetAutoDetection;
        disableAutoChargeRef.current = disableAutoCharge;
        triggerChargeRef.current = triggerCharge;
    }, [resetAutoDetection, disableAutoCharge, triggerCharge]);

    // ── Effect: 머신 disconnect 시 진행 중 로스트 초기화 ─────────
    useEffect(() => {
        if (sidecarConnected) return;
        if (phase === 'idle' || phase === 'ended') return;
        lifecycle.resetActiveRoast();
    }, [sidecarConnected]);

    // ── Effect: 타이머 ────────────────────────────────────────────
    useEffect(() => {
        if (!isRunning) return;
        const interval = setInterval(() => tick(), 1000);
        return () => clearInterval(interval);
    }, [isRunning, tick]);

    // ── Effect: 로스팅 중 창 닫기 확인 ────────────────────────────
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

    // ── 단계 표시 및 파생값 ──────────────────────────────────────
    const roastPhaseName = getRoastPhaseName(charged, phase, elapsed, logEntries);
    const roastPhaseColor = getRoastPhaseColor(charged, roastPhaseName);
    const eventMarkers = useMemo(() => buildEventMarkers(logEntries), [logEntries]);
    const phaseSegments = useMemo(
        () => (roastSettings.showPhaseBar ? computePhaseSegments(logEntries, elapsed, charged) : []),
        [roastSettings.showPhaseBar, logEntries, elapsed, charged],
    );
    const displayRoR = toDisplayRoR(liveData?.ror ?? 0, unit).toFixed(1);

    // ── 키보드 단축키 ─────────────────────────────────────────────
    useRoastKeyboardShortcuts({
        isActive,
        isFullscreen,
        showEndRoastModal: saveFlow.flow.endRoastModal,
        showSummaryModal: saveFlow.flow.summaryModal,
        phase,
        onToggleFullscreen: toggleFullscreen,
        onExitFullscreen: exitFullscreen,
        onEnterStandby: lifecycle.handleEnterStandby,
        onManualCharge: lifecycle.handleManualCharge,
        onMarkEvent: markEvent,
        onMarkDrop: handleDrop,
    });

    useChartKeyboard({
        isActive,
        isFullscreen,
        showEndRoastModal: saveFlow.flow.endRoastModal,
        showSummaryModal: saveFlow.flow.summaryModal,
        minTime: chart.minTime,
        maxTime: chart.maxTime,
        zoomRange: chart.effectiveZoomRange,
        setZoomRange: chart.setZoomRange,
        visibleChartData: chart.visibleChartData,
        hoveredChartIndexRef: chart.hoveredChartIndexRef,
    });

    useHotkeys(
        'escape',
        (e) => {
            e.preventDefault();
            saveFlow.flow.closeEndRoast();
        },
        { enabled: saveFlow.flow.endRoastModal },
        [saveFlow.flow.endRoastModal, saveFlow.flow.closeEndRoast],
    );

    const handleChartCursorIdx = useCallback(
        (idx: number | null) => {
            chart.setHoveredChartIndex(idx);
        },
        [chart.setHoveredChartIndex],
    );

    // ── 이벤트 핸들러 ─────────────────────────────────────────────
    const handleEndRoastClick = useCallback(() => {
        if (roastEnded || !charged) return;
        saveFlow.flow.openEndRoast();
    }, [roastEnded, charged, saveFlow.flow.openEndRoast]);

    const confirmEndRoast = useCallback(() => {
        const summaryData = lifecycle.confirmEndRoast();
        saveFlow.flow.confirmEndRoast(summaryData);
    }, [lifecycle, saveFlow.flow.confirmEndRoast]);

    const handleEventMarkerDrag = useCallback(
        (event: string, newTimeSec: number) => {
            const newTimeStr = formatElapsed(newTimeSec);
            setLogEntries((prev) =>
                prev.map((entry) => (entry.event === event ? { ...entry, time: newTimeStr } : entry)),
            );
        },
        [setLogEntries],
    );

    const [noteInput, setNoteInput] = useState('');
    const handleNoteSubmit = useCallback(() => {
        if (!noteInput.trim()) return;
        markEvent('Note', noteInput.trim());
        setNoteInput('');
    }, [noteInput, markEvent]);

    // ── 표시용 파생값 ─────────────────────────────────────────────
    const { deltaBT, deltaET } = useMemo(() => calcDelta(livePoints, unit), [livePoints, unit]);
    const roastLogDisplayEntries = useMemo(
        () => buildRoastLogDisplayEntries(logEntries, roastEnded, charged, timeStr, rawBT, roastPhaseName, unit),
        [logEntries, roastEnded, charged, timeStr, rawBT, roastPhaseName, unit],
    );

    // ── 렌더 ──────────────────────────────────────────────────────
    return (
        <div className="px-[32px] py-[24px] flex flex-col gap-4 h-full min-h-0 overflow-hidden">
            <RoastHeader
                phase={roastPhaseName}
                targetProfileId={targetProfileId}
                selectedBeanId={selectedBeanId}
                fallbackBeanName={handoffBeanName}
                onTargetProfileChange={setUserSelectedTarget}
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

            <div
                className={`bg-(--color-roast-bg) flex flex-col min-h-0 overflow-hidden ${
                    isFullscreen
                        ? 'fixed inset-0 z-9999 h-screen w-screen p-10'
                        : 'rounded relative z-1 px-6 pb-4 pt-10 flex-1 dark:border dark:border-[#585d61]'
                }`}
            >
                <div className="flex gap-6 flex-1 min-h-0 flex-row">
                    <RoastChartContainer
                        chartAreaRef={chart.chartAreaRef}
                        mainChartHeight={chart.mainChartHeight}
                        effectiveZoomRange={chart.effectiveZoomRange}
                        isChartDragging={chart.isChartDragging}
                        isFullscreen={isFullscreen}
                        handleChartWheel={chart.handleChartWheel}
                        handleChartPointerDown={chart.handleChartPointerDown}
                        handleChartPointerMove={chart.handleChartPointerMove}
                        endChartDrag={chart.endChartDrag}
                        xs={chart.visibleXs}
                        btActual={chart.visibleBtActual}
                        etActual={chart.visibleEtActual}
                        rorActual={chart.visibleRorActual}
                        rorEtActual={chart.visibleRorEtActual}
                        targetXs={chart.visibleTargetXs}
                        targetBt={chart.visibleTargetBt}
                        showTargetCurve={
                            roastSettings.showTargetCurve && !!targetProfileId && targetCurvePoints.length > 0
                        }
                        showET={roastSettings.showET}
                        showRoR={roastSettings.showRoRChart}
                        showRoRET={roastSettings.showRoRET}
                        controlData={
                            roastSettings.showControlChart
                                ? {
                                      xs: chart.visibleControlXs,
                                      drumTemp: chart.visibleDrumTemp,
                                      heatPower: chart.visibleHeatPower,
                                      fanSpeed: chart.visibleFanSpeed,
                                  }
                                : undefined
                        }
                        elapsed={elapsed}
                        eventMarkers={eventMarkers}
                        turningPoints={turningPoints}
                        phaseSegments={phaseSegments}
                        unit={unit}
                        targetProfileName={targetProfile?.name}
                        onCursorIdx={handleChartCursorIdx}
                        onEventMarkerDrag={handleEventMarkerDrag}
                    />

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
                        onEnterStandby={lifecycle.handleEnterStandby}
                        onManualCharge={lifecycle.handleManualCharge}
                        onEndRoast={handleEndRoastClick}
                    />
                </div>
            </div>

            <EndRoastModal
                open={saveFlow.flow.endRoastModal}
                timeStr={timeStr}
                onClose={saveFlow.flow.closeEndRoast}
                onConfirm={confirmEndRoast}
            />
            <RoastSummaryModal
                open={saveFlow.flow.summaryModal}
                summaryData={saveFlow.flow.summaryData}
                eventMarkerColor={EVENT_MARKER_COLORS}
                isSaving={saveFlow.isSaving}
                ambientTemp={weatherData?.temperature}
                ambientHumidity={weatherData?.humidity}
                onClose={saveFlow.flow.closeSummary}
                onDiscard={() => {
                    saveFlow.flow.discardSummary();
                    lifecycle.resetActiveRoast();
                }}
                onSave={saveFlow.handleSave}
            />

            <StockDeductModal
                open={saveFlow.flow.deductModal}
                beanName={saveFlow.flow.pendingStockDeduct?.beanName ?? undefined}
                deductionKg={((saveFlow.flow.pendingStockDeduct?.deductionGrams ?? 0) / 1000).toFixed(1)}
                canDeduct={Boolean(saveFlow.flow.pendingStockDeduct)}
                onClose={saveFlow.flow.finishDeductFlow}
                onConfirm={saveFlow.handleStockDeductConfirm}
            />

            <PlanBatchContinueModal
                show={saveFlow.flow.continueModal}
                planBatchHandoff={planBatchHandoff}
                batchDone={batchDone}
                sessionsAfter={sessionsAfter}
                onPlanBatchComplete={onPlanBatchComplete}
                onDismiss={saveFlow.flow.dismissContinue}
            />
        </div>
    );
};
