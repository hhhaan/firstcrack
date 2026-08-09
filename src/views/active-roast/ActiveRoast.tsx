import { useBeans } from '@entities/bean/queries';
import { useActiveWorkspace } from '@entities/organization';
import { useProfile } from '@entities/profile';
import { useResolvedProfileCurve, useRoastProfiles } from '@entities/roast-profile';
import {
    computePhaseSegments,
    formatTemp,
    toDisplayRoR,
    useEffectivePollIntervalMs,
    useRoastActions,
    useRoastKeyboardShortcuts,
    useRoastSettings,
} from '@features/active-roast';
import { EVENT_MARKER_COLORS } from '@features/active-roast/lib/chart-config';
import { applyEventMarkerDrag } from '@features/active-roast/lib/event-marker-drag';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import { useRoastAlerts } from '@features/active-roast/model/useRoastAlerts';
import { useRoastLog } from '@features/active-roast/model/useRoastLog';
import { ActiveRoastOnboarding } from '@features/active-roast/ui/ActiveRoastOnboarding';
import { MachineControlPanel } from '@features/machine-control';
import { useWeather } from '@shared/api/weather';
import { formatElapsed } from '@shared/lib/format';
import { sidecar } from '@shared/lib/sidecar';
import { flushTsv } from '@shared/lib/tsv-writer';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import { useThemeStore } from '@shared/store/theme';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useShallow } from 'zustand/react/shallow';
import {
    buildEventMarkers,
    buildRoastLogDisplayEntries,
    calcDelta,
    calcDevTime,
    calcTargetDelta,
} from './lib/display-derivatives';
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
    const pollIntervalMs = useEffectivePollIntervalMs();
    const unit = roastSettings.temperatureUnit;

    // ── 스토어 구독 ───────────────────────────────────────────────
    const {
        phase,
        elapsed,
        liveData,
        pid: pidRuntime,
        tick,
        sessionId,
        sidecarConnected,
        machineCapabilities,
    } = useRoastingStore(
        useShallow((s) => ({
            phase: s.phase,
            elapsed: s.elapsed,
            liveData: s.liveData,
            pid: s.pid,
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
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: dbProfiles = [] } = useRoastProfiles(workspaceOwnerId);
    const { data: userProfile } = useProfile(user?.id ?? '');

    // ── 배치 핸드오프 ─────────────────────────────────────────────
    const planBatchHandoff = useRoastSessionStore((s) => s.planBatchHandoff);
    const startBatch = useRoastSessionStore((s) => s.startBatch);
    const completeBatch = useRoastSessionStore((s) => s.completeBatch);

    // ── 프로파일/원두 선택 ─────────────────────────────────────────
    const { data: beans = [], isSuccess: beansReady } = useBeans(workspaceOwnerId);
    const { targetProfileId, selectedBeanId, setSelectedBeanId, handoffBeanName, setUserSelectedTarget } =
        useRoastProfileSelection({ isActive, charged, userProfile, beans, beansReady });

    // ── UI 상태 ───────────────────────────────────────────────────
    const [isRunning, setIsRunning] = useState(false);
    const isRunningRef = useRef(isRunning);
    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    // 미저장 로스트(진행 중 or ended 요약) — 창 닫기 가드용 (#177)
    const hasUnsavedRoastRef = useRef(false);
    useEffect(() => {
        hasUnsavedRoastRef.current = isRunning || phase === 'ended';
    }, [isRunning, phase]);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), []);
    const exitFullscreen = useCallback(() => setIsFullscreen(false), []);

    // ── 공유 ref ──────────────────────────────────────────────────
    const roastStartTimeRef = useRef(0);

    // ── 사이드카 폴림 및 실시간 데이터 ───────────────────────────
    const { livePoints, setLivePoints } = useSidecarPolling({
        isActive,
        phase,
        pollIntervalMs,
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
    });

    // ── 도메인 훅 ─────────────────────────────────────────────────
    const rawBT = liveData?.bt ?? null;
    const rawET = liveData?.et ?? null;
    const timeStr = formatElapsed(elapsed);

    const { logEntries, pressedButtons, markEvent, cycleFc, handleDrop, setLogEntries, removeLogEntry } = useRoastLog(
        unit,
        rawBT,
        elapsed,
    );

    const fcDualMarkEnabled = roastSettings.fcDualMarkEnabled;
    const fcStartEntry = logEntries.find((e) => e.event === 'FC Start');
    // 고아 Rolling(FC Start 삭제됨)은 기준점이 없어 지표를 내지 않는다
    const fcRollingEntry = fcStartEntry ? logEntries.find((e) => e.event === 'FC Rolling') : undefined;
    const { devTimeStr, devTimeOnly, dtrPct } = useMemo(
        () => calcDevTime(fcStartEntry, elapsed),
        [fcStartEntry, elapsed],
    );
    const { devTimeOnly: rollingDevTimeStr, dtrPct: rollingDtrPct } = useMemo(
        () => calcDevTime(fcRollingEntry, elapsed),
        [fcRollingEntry, elapsed],
    );

    // 라이프사이클과 하위 훅 사이 순환 의존성을 refs로 분리
    const resetAutoDetectionRef = useRef<() => void>(() => {});
    const disableAutoChargeRef = useRef<() => void>(() => {});
    const rearmAutoChargeRef = useRef<() => void>(() => {});
    const triggerChargeRef = useRef<(bt?: number | null, chargeTimeMs?: number) => void>(() => {});

    const lifecycle = useRoastLifecycle({
        phase,
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
        rearmAutoChargeRef,
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

    const { turningPoints, resetAutoDetection, disableAutoCharge, rearmAutoCharge } = useAutoDetection({
        livePoints,
        onAutoCharge: triggerCharge,
        onAutoDrop: handleAutoDrop,
        onTurningPoint: handleTurningPoint,
        autoChargeDropC: roastSettings.autoChargeDropC,
        autoDropDropC: roastSettings.autoDropDropC,
        yellowTempC: roastSettings.yellowTempC,
        unit,
        markEvent,
        logEntries,
        autoYellowEnabled: roastSettings.autoYellowEnabled,
    });

    useEffect(() => {
        resetAutoDetectionRef.current = resetAutoDetection;
        disableAutoChargeRef.current = disableAutoCharge;
        rearmAutoChargeRef.current = rearmAutoCharge;
        triggerChargeRef.current = triggerCharge;
    }, [resetAutoDetection, disableAutoCharge, rearmAutoCharge, triggerCharge]);

    const activeAlerts = useRoastAlerts({
        enabled: roastSettings.alertsEnabled,
        soundEnabled: roastSettings.alertSoundEnabled,
        rorCrashCPerMin: roastSettings.alertRorCrashCPerMin,
        btMaxC: roastSettings.alertBtMaxC,
        afterTurningPoint: turningPoints.length > 0,
        logEntries,
    });

    // ── Effect: rorSpanSec 변경 시 사이드카에 전달 ────────────────
    useEffect(() => {
        if (!sidecarConnected) return;
        sidecar.updateSettings({ ror_window_sec: roastSettings.rorSpanSec }).catch(() => {});
    }, [sidecarConnected, roastSettings.rorSpanSec]);

    // ── Effect: 머신 disconnect 시 대기 상태만 초기화 ─────────────
    // 로스팅 중(원두가 드럼 안) 끊김은 세션 보존 — 폴링이 계속 재시도하므로
    // 재연결되면 커브가 이어진다(끊긴 구간만 갭). 헤더 배너가 끊김을 표시한다.
    useEffect(() => {
        if (sidecarConnected) return;
        if (phase !== 'preheating' && phase !== 'standby') return;
        lifecycle.resetActiveRoast();
    }, [sidecarConnected, phase, lifecycle.resetActiveRoast]);

    // ── Effect: 타이머 ────────────────────────────────────────────
    useEffect(() => {
        if (!isRunning) return;
        const interval = setInterval(() => tick(), 1000);
        return () => clearInterval(interval);
    }, [isRunning, tick]);

    // ── Effect: 로스팅 중 / ended 미저장 창 닫기 확인 (#177) ──────
    useEffect(() => {
        if (!('__TAURI_INTERNALS__' in window)) return;
        const win = getCurrentWindow();
        let unlisten: (() => void) | undefined;
        let active = true;
        void win
            .onCloseRequested(async (e) => {
                if (!hasUnsavedRoastRef.current) return;
                e.preventDefault();
                const running = isRunningRef.current;
                const ok = await ask(
                    running
                        ? '로스팅이 진행 중입니다. 정말 종료하시겠습니까?'
                        : '저장되지 않은 로스트가 있습니다. 저장하지 않고 종료하시겠습니까?',
                    {
                        title: '로스팅 진행 중',
                        kind: 'warning',
                        okLabel: '종료',
                        cancelLabel: '취소',
                    },
                );
                if (ok) {
                    const sid = useRoastingStore.getState().sessionId;
                    if (sid) {
                        try {
                            await flushTsv(sid);
                        } catch {
                            // flush failure must not block window close
                        }
                    }
                    unlisten?.();
                    void win.close();
                }
            })
            .then((fn) => {
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

    // ── Effect: 타이틀바에 실시간 온도 표시 ─────────────────────
    useEffect(() => {
        if (!('__TAURI_INTERNALS__' in window)) return;
        const isActivePhase = phase === 'roasting' || phase === 'preheating' || phase === 'standby';
        if (!isActivePhase) {
            void getCurrentWindow().setTitle('First Crack');
            return;
        }
        const bt = formatTemp(rawBT, unit);
        const et = formatTemp(rawET, unit);
        void getCurrentWindow().setTitle(`First Crack — BT ${bt} | ET ${et} | ${timeStr}`);
    }, [phase, rawBT, rawET, timeStr, unit]);

    // ── 단계 표시 및 파생값 ──────────────────────────────────────
    const roastPhaseName = getRoastPhaseName(charged, phase, elapsed, logEntries);
    const roastPhaseColor = getRoastPhaseColor(charged, roastPhaseName);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    const eventMarkers = useMemo(() => buildEventMarkers(logEntries), [logEntries, resolvedTheme]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    const phaseSegments = useMemo(
        () => (roastSettings.showPhaseBar ? computePhaseSegments(logEntries, elapsed, charged) : []),
        [roastSettings.showPhaseBar, logEntries, elapsed, charged, resolvedTheme],
    );
    const displayRoR = toDisplayRoR(liveData?.ror ?? 0, unit).toFixed(1);

    // ── 키보드 단축키 ─────────────────────────────────────────────
    useRoastKeyboardShortcuts({
        isActive,
        isFullscreen,
        showEndRoastModal: saveFlow.flow.endRoastModal,
        showSummaryModal: saveFlow.flow.summaryModal,
        showContinueModal: saveFlow.flow.continueModal,
        phase,
        onToggleFullscreen: toggleFullscreen,
        onExitFullscreen: exitFullscreen,
        onEnterStandby: lifecycle.handleEnterStandby,
        onManualCharge: () => {
            void lifecycle.handleManualCharge();
        },
        onMarkEvent: markEvent,
        onCycleFc: fcDualMarkEnabled ? cycleFc : undefined,
        onMarkDrop: handleDrop,
    });

    useChartKeyboard({
        isActive,
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
        // ended + summary payload → reopen (safety net if modal was dismissed) (#172)
        if (roastEnded) {
            if (saveFlow.flow.summaryData) saveFlow.flow.reopenSummary();
            return;
        }
        if (!charged) return;
        saveFlow.flow.openEndRoast();
    }, [roastEnded, charged, saveFlow.flow.summaryData, saveFlow.flow.reopenSummary, saveFlow.flow.openEndRoast]);

    const confirmEndRoast = useCallback(() => {
        const summaryData = lifecycle.confirmEndRoast();
        saveFlow.confirmEndRoast(summaryData);
    }, [lifecycle, saveFlow.confirmEndRoast]);

    const handleEventMarkerDrag = useCallback(
        (event: string, newTimeSec: number) => {
            setLogEntries((prev) => applyEventMarkerDrag(prev, event, newTimeSec, livePoints, unit));
        },
        [setLogEntries, livePoints, unit],
    );

    const [noteInput, setNoteInput] = useState('');
    const handleNoteSubmit = useCallback(() => {
        if (!noteInput.trim()) return;
        markEvent('Note', noteInput.trim());
        setNoteInput('');
    }, [noteInput, markEvent]);

    // ── 표시용 파생값 ─────────────────────────────────────────────
    const { deltaBT, deltaET } = useMemo(() => calcDelta(livePoints, unit), [livePoints, unit]);
    const targetDelta = useMemo(
        () =>
            roastSettings.showTargetCurve && charged && !roastEnded
                ? calcTargetDelta(rawBT, targetCurvePoints, elapsed, unit)
                : null,
        [roastSettings.showTargetCurve, charged, roastEnded, rawBT, targetCurvePoints, elapsed, unit],
    );
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
                        ? 'fixed inset-0 z-9999 h-screen w-screen py-[30px] pl-2.5 pr-2.5'
                        : 'rounded relative z-1 pl-2.5 pr-2.5 py-[30px] flex-1 dark:border dark:border-[#585d61]'
                }`}
            >
                <div className="flex gap-0 flex-1 min-h-0 flex-row">
                    <RoastChartContainer
                        chartAreaRef={chart.chartAreaRef}
                        mainChartHeight={chart.mainChartHeight}
                        effectiveZoomRange={chart.effectiveZoomRange}
                        isChartDragging={chart.isChartDragging}
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
                        showTargetDeltaLabel={
                            roastSettings.showTargetDeltaLabel && !!targetProfileId && targetCurvePoints.length > 0
                        }
                        showET={roastSettings.showET}
                        showRoR={roastSettings.showRoRChart}
                        showRoRET={roastSettings.showRoRET}
                        controlData={
                            roastSettings.showControlChart &&
                            (roastSettings.showControlDrum ||
                                roastSettings.showControlHeat ||
                                roastSettings.showControlFan)
                                ? {
                                      xs: chart.visibleControlXs,
                                      drumTemp: chart.visibleDrumTemp,
                                      heatPower: chart.visibleHeatPower,
                                      fanSpeed: chart.visibleFanSpeed,
                                  }
                                : undefined
                        }
                        showControlDrum={roastSettings.showControlDrum}
                        showControlHeat={roastSettings.showControlHeat}
                        showControlFan={roastSettings.showControlFan}
                        controlChartHeightPct={roastSettings.controlChartHeightPct}
                        controlYMin={roastSettings.controlYMin}
                        controlYMax={roastSettings.controlYMax}
                        tempMinC={roastSettings.tempMinC}
                        tempMaxC={roastSettings.tempMaxC}
                        rorYMin={roastSettings.rorYMin}
                        rorYMax={roastSettings.rorYMax}
                        elapsed={elapsed}
                        charged={charged}
                        eventMarkerStyle={roastSettings.eventMarkerStyle}
                        eventMarkers={eventMarkers}
                        turningPoints={turningPoints}
                        phaseSegments={phaseSegments}
                        showFcBand={roastSettings.showFcBand}
                        unit={unit}
                        targetProfileName={targetProfile?.name}
                        onCursorIdx={handleChartCursorIdx}
                        onEventMarkerDrag={handleEventMarkerDrag}
                    />

                    {/* 그래프 | Machine Control | 온도 패널 — MC는 쓰기 가능 머신에서만 렌더 */}
                    <MachineControlPanel
                        sidecarConnected={sidecarConnected}
                        liveData={liveData}
                        pidRuntime={pidRuntime}
                        // 배출·로스팅 종료 시 PID 자동 해제 (무인 화력 방지)
                        roastFinished={roastEnded || logEntries.some((e) => e.event === 'Drop')}
                        pidDropBehavior={roastSettings.pidDropBehavior}
                    />

                    <RoastSidePanel
                        rawBT={rawBT}
                        rawET={rawET}
                        displayRoR={displayRoR}
                        timeStr={timeStr}
                        unit={unit}
                        phase={phase}
                        roastPhaseName={roastPhaseName}
                        roastPhaseColor={roastPhaseColor}
                        charged={charged}
                        roastEnded={roastEnded}
                        deltaBT={deltaBT}
                        deltaET={deltaET}
                        targetDelta={targetDelta}
                        activeAlerts={activeAlerts}
                        dtrPct={dtrPct}
                        devTimeStr={devTimeOnly}
                        rollingDtrPct={rollingDtrPct}
                        rollingDevTimeStr={rollingDevTimeStr}
                        fcDualMarkEnabled={fcDualMarkEnabled}
                        logEntries={logEntries}
                        pressedButtons={pressedButtons}
                        roastLogDisplayEntries={roastLogDisplayEntries}
                        noteInput={noteInput}
                        onNoteChange={setNoteInput}
                        onNoteSubmit={handleNoteSubmit}
                        onMarkEvent={markEvent}
                        onCycleFc={cycleFc}
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
                selectedBeanId={selectedBeanId}
                planBatchHandoff={planBatchHandoff}
                fallbackBeanName={handoffBeanName}
                onClose={saveFlow.flow.closeSummary}
                onDiscard={() => {
                    saveFlow.discardSummary();
                    lifecycle.resetActiveRoast();
                }}
                onSave={saveFlow.handleSave}
            />

            <PlanBatchContinueModal
                show={saveFlow.flow.continueModal}
                candidates={saveFlow.flow.continueCandidates}
                onStartNext={(handoff) => {
                    startBatch(handoff);
                    saveFlow.flow.dismissContinue();
                }}
                onDismiss={() => {
                    completeBatch();
                    saveFlow.flow.dismissContinue();
                }}
                onGoToSchedule={() => {
                    saveFlow.flow.dismissContinue();
                    onPlanBatchComplete?.();
                }}
            />

            <ActiveRoastOnboarding isActive={isActive} />
        </div>
    );
};
