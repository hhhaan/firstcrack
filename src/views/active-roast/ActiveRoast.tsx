import { useBeans } from '@entities/bean/queries';
import { useActiveWorkspace } from '@entities/organization';
import { useProfile, useUpdateProfile } from '@entities/profile';
import { useBbpCurve } from '@entities/roast';
import { resolveSourceSession, useResolvedProfileCurve, useRoastProfiles } from '@entities/roast-profile';
import {
    computePhaseSegments,
    formatTemp,
    isRoastShortcutBaseEnabled,
    toDisplayRoR,
    useBbpStore,
    useBbpTimer,
    useEffectivePollIntervalMs,
    useRoastActions,
    useRoastKeyboardShortcuts,
    useRoastSettings,
} from '@features/active-roast';
import { applyEventMarkerEdit, nearestLivePointAt } from '@features/active-roast/lib/event-marker-drag';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import { useRoastAlerts } from '@features/active-roast/model/useRoastAlerts';
import { useRoastLog } from '@features/active-roast/model/useRoastLog';
import { ActiveRoastOnboarding } from '@features/active-roast/ui/ActiveRoastOnboarding';
import { MachineControlPanel, useMachineControlComposition } from '@features/machine-control';
import { profileHeatTarget } from '@features/machine-control/lib/heater-events';
import type { ReplayStopReason } from '@features/machine-control/model/useReplayControl';
import { useWeather } from '@shared/api/weather';
import { FEATURE, useFeature } from '@shared/lib/features';
import { formatElapsed } from '@shared/lib/format';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { flushTsv } from '@shared/lib/tsv-writer';
import { useAuthStore } from '@shared/store/auth';
import { useRoastSessionStore } from '@shared/store/roastSession';
import { useThemeStore } from '@shared/store/theme';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
    chartOnlyPreheatDecision,
    noteChartOnlyPreheatMount,
    shouldResetChartOnlyPreheatOnPageRestore,
    takePreheatMountEpoch,
} from './lib/bbp-preheat';
import {
    buildEventMarkers,
    buildRoastLogDisplayEntries,
    calcDelta,
    calcDevTime,
    calcTargetDelta,
} from './lib/display-derivatives';
import { resolveLiveChartView } from './lib/live-chart-view';
import { getRoastPhaseColor, getRoastPhaseName } from './lib/roast-phase';
import { useCompletedRoastStore } from './model/completedRoast';
import { useChartKeyboard } from './model/useChartKeyboard';
import { useChartPipeline } from './model/useChartPipeline';
import { useRoastLifecycle } from './model/useRoastLifecycle';
import { useRoastProfileSelection } from './model/useRoastProfileSelection';
import { useRoastSaveFlow } from './model/useRoastSaveFlow';
import { useSidecarPolling } from './model/useSidecarPolling';
import { EndRoastModal } from './ui/EndRoastModal';
import { PlanBatchContinueModal } from './ui/PlanBatchContinueModal';
import { ReplayProfileChangeModal } from './ui/ReplayProfileChangeModal';
import { RoastChartContainer } from './ui/RoastChartContainer';
import { RoastHeader } from './ui/RoastHeader';
import { RoastSidePanel } from './ui/RoastSidePanel';
import { RoastSummaryModal } from './ui/RoastSummaryModal';
import { UnsavedRoastBanner } from './ui/UnsavedRoastBanner';

interface ActiveRoastProps {
    isActive: boolean;
    onOpenRoastSettings?: () => void;
    onPlanBatchComplete?: () => void;
}

/** Chart-only preheat older than this module evaluation is not a saved Charge wait. */
const chartOnlyPreheatBootMs = Date.now();

export const ActiveRoast = ({ isActive, onOpenRoastSettings, onPlanBatchComplete }: ActiveRoastProps) => {
    const { t } = useTranslation();
    const hasRawTemperature = useRoastingStore((state) => state.rawTemperature !== null);
    // ── 설정 ──────────────────────────────────────────────────────
    const roastSettings = useRoastSettings();
    const pollIntervalMs = useEffectivePollIntervalMs();
    const unit = roastSettings.temperatureUnit;
    const bbpEnabled = useFeature(FEATURE.bbp) && roastSettings.bbpEnabled;
    const bbpElapsed = useBbpTimer();
    const bbpTimer = bbpEnabled ? bbpElapsed : null;
    const bbpActive = useBbpStore((s) => s.active);
    const bbpRecording = useBbpStore((s) => s.recording);
    const bbpPoints = useBbpStore((s) => s.points);
    const awaitingNextCharge = useRoastingStore((s) => s.awaitingNextCharge);
    const heatHoldAfterDrop = useRoastingStore((s) => s.heatHoldAfterDrop);
    const bbpChargeWait = (bbpActive && bbpRecording) || awaitingNextCharge;

    useEffect(() => {
        if (!roastSettings.bbpEnabled) {
            useBbpStore.getState().abort();
        } else if (bbpEnabled && awaitingNextCharge && (!bbpActive || !bbpRecording)) {
            useBbpStore.getState().begin(Date.now());
        }
    }, [bbpEnabled, roastSettings.bbpEnabled, awaitingNextCharge, bbpActive, bbpRecording]);

    // ── 스토어 구독 ───────────────────────────────────────────────
    const {
        phase,
        elapsed,
        liveData,
        pid: pidRuntime,
        tick,
        sessionId,
        sidecarConnected,
        reconnecting,
        machineSnapshot,
        observationQuality,
        lastValidReceivedAtMs,
    } = useRoastingStore(
        useShallow((s) => ({
            phase: s.phase,
            elapsed: s.elapsed,
            liveData: s.liveData,
            pid: s.pid,
            tick: s.tick,
            sessionId: s.sessionId,
            sidecarConnected: s.sidecarConnected,
            reconnecting: s.reconnecting,
            machineSnapshot: s.machineSnapshot,
            observationQuality: s.observation?.quality ?? null,
            lastValidReceivedAtMs: s.observation?.lastValidReceivedAtMs ?? null,
        })),
    );
    const storeActions = useRoastingStore.getState();
    const {
        enterPreheating,
        enterStandby,
        startCharge: storeStartCharge,
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
    const { mutate: updateProfile } = useUpdateProfile(user?.id ?? '');
    const saveDefaultProfile = useCallback(
        (id: string | null) => {
            updateProfile({ default_roast_profile_id: id });
        },
        [updateProfile],
    );

    // ── 배치 핸드오프 ─────────────────────────────────────────────
    const planBatchHandoff = useRoastSessionStore((s) => s.planBatchHandoff);
    const completeBatch = useRoastSessionStore((s) => s.completeBatch);

    // ── 프로파일/원두 선택 ─────────────────────────────────────────
    const { data: beans = [], isSuccess: beansReady } = useBeans(workspaceOwnerId);
    const replayActiveRef = useRef(false);
    const replayStopRef = useRef<(reason?: ReplayStopReason) => void>(() => {});
    const profileChangeGenRef = useRef(0);
    const pendingProfileChangeRef = useRef<{ resolve: (ok: boolean) => void; gen: number } | null>(null);
    const [profileChangeOpen, setProfileChangeOpen] = useState(false);
    const confirmTargetChange = useCallback((_nextId: string | null) => {
        if (!replayActiveRef.current) return Promise.resolve(true);
        pendingProfileChangeRef.current?.resolve(false);
        return new Promise<boolean>((resolve) => {
            pendingProfileChangeRef.current = { resolve, gen: profileChangeGenRef.current };
            setProfileChangeOpen(true);
        });
    }, []);
    const commitApprovedTarget = useCallback((_id: string | null) => {
        replayStopRef.current('profileChanged');
    }, []);
    const selectionEpoch = `${workspaceOwnerId ?? ''}:${sessionId ?? 'pre'}`;
    const { targetProfileId, selectedBeanId, setSelectedBeanId, handoffBeanName, setUserSelectedTarget } =
        useRoastProfileSelection({
            isActive,
            charged,
            userProfile,
            beans,
            beansReady,
            confirmTargetChange,
            commitApprovedTarget,
            saveDefaultProfile,
            selectionEpoch,
        });

    // ── UI 상태 ───────────────────────────────────────────────────
    const [isRunning, setIsRunning] = useState(false);
    const isRunningRef = useRef(isRunning);
    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    // 미저장 로스트(진행 중 or ended 요약) — 창 닫기 가드용 (#177)
    const hasUnsavedRoastRef = useRef(false);
    useEffect(() => {
        hasUnsavedRoastRef.current = isRunning || phase === 'ended' || awaitingNextCharge;
    }, [isRunning, phase, awaitingNextCharge]);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), []);
    const exitFullscreen = useCallback(() => setIsFullscreen(false), []);

    // ── 공유 ref ──────────────────────────────────────────────────
    // 리마운트(ErrorBoundary 재시도 등) 시 스토어 roastStartMs로 재수화 —
    // 0으로 남으면 폴링이 로스팅 분기를 영원히 건너뛴다 (#317)
    const roastStartTimeRef = useRef(useRoastingStore.getState().roastStartMs);

    // ── 도메인 훅 ─────────────────────────────────────────────────
    const rawBT = liveData?.bt ?? null;
    const rawET = liveData?.et ?? null;
    const timeStr = formatElapsed(elapsed);

    const { logEntries, pressedButtons, markEvent, cycleFc, fcDualUnwind, setLogEntries, removeLogEntry } = useRoastLog(
        unit,
        rawBT,
        elapsed,
    );

    // ── 사이드카 폴림 및 실시간 데이터 ───────────────────────────
    const { livePoints, setLivePoints } = useSidecarPolling({
        isActive,
        phase,
        pollIntervalMs,
        enterPreheating,
        setConnected,
        roastStartTimeRef,
        sessionId,
        chargeBt: logEntries.find((entry) => entry.event === 'Charge')?.tempC ?? null,
    });

    // ── 차트 데이터 준비 ──────────────────────────────────────────
    const targetProfile = useMemo(
        () => dbProfiles.find((p) => p.id === targetProfileId && p.user_id === workspaceOwnerId) ?? null,
        [dbProfiles, targetProfileId, workspaceOwnerId],
    );
    const { points: targetCurvePoints, isLoading: curveLoading } = useResolvedProfileCurve(targetProfile);
    const replayPoints = !targetProfileId ? [] : curveLoading ? null : targetCurvePoints;
    const sourceSession = resolveSourceSession(targetProfile?.source_session);
    const waitingForCharge = bbpActive || !charged;
    const bbpTarget = useBbpCurve(
        workspaceOwnerId,
        targetProfile?.source_session_id ?? null,
        sourceSession?.bbp_tsv_path,
        waitingForCharge,
    );
    // Replay 컷오프는 레퍼런스의 Drop 마크다. duration_sec는 End 확정 시각(store elapsed)이라
    // Drop→End 사이 쿨다운 조작(다음 배치 예열용 가스 올림)이 재생 계획에 섞인다.
    const sourceEvents = useMemo(
        () => parseStoredRoastEvents(resolveSourceSession(targetProfile?.source_session)?.events),
        [targetProfile],
    );
    const replayDropTime = useMemo(
        () => sourceEvents.find((e) => e.type === 'Drop')?.time_sec ?? targetProfile?.duration_sec ?? null,
        [sourceEvents, targetProfile?.duration_sec],
    );
    const heatTarget = useMemo(() => {
        if (!targetProfile) return undefined;
        return profileHeatTarget(targetCurvePoints, replayDropTime, targetProfile.heater_events);
    }, [targetProfile, targetCurvePoints, replayDropTime]);
    const referenceFcStartSec = useMemo(
        () => sourceEvents.find((e) => e.type === 'FC Start')?.time_sec ?? null,
        [sourceEvents],
    );

    // Replay는 같은 기기만 — 키가 양쪽 다 있고 다를 때만 차단(레거시 null 프로파일은 허용)
    const referenceKey = targetProfile?.machine_roaster_key ?? null;
    const currentKey = machineSnapshot?.machine_roaster_key ?? null;
    const replayMachineMismatch = referenceKey != null && currentKey != null && referenceKey !== currentKey;
    // biome-ignore lint/correctness/useExhaustiveDependencies: identity for in-flight Replay profile confirm
    useEffect(() => {
        profileChangeGenRef.current += 1;
        const pending = pendingProfileChangeRef.current;
        if (!pending) return;
        pending.resolve(false);
        pendingProfileChangeRef.current = null;
        setProfileChangeOpen(false);
    }, [sessionId, workspaceOwnerId, targetProfileId]);
    const cancelReplayProfileChange = useCallback(() => {
        pendingProfileChangeRef.current?.resolve(false);
        pendingProfileChangeRef.current = null;
        setProfileChangeOpen(false);
    }, []);
    const confirmReplayProfileChange = useCallback(() => {
        const pending = pendingProfileChangeRef.current;
        pendingProfileChangeRef.current = null;
        setProfileChangeOpen(false);
        if (!pending) return;
        if (pending.gen !== profileChangeGenRef.current) {
            pending.resolve(false);
            return;
        }
        pending.resolve(true);
    }, []);

    const chartView = useMemo(
        () =>
            resolveLiveChartView({
                bbpActive: bbpEnabled && bbpActive,
                charged,
                livePoints,
                bbpPoints,
                roastTarget: targetCurvePoints,
                bbpTarget: bbpTarget.data ?? [],
                bbpTargetError: bbpTarget.isError,
            }),
        [bbpActive, bbpEnabled, bbpPoints, bbpTarget.data, bbpTarget.isError, charged, livePoints, targetCurvePoints],
    );
    const bbpNowSec = bbpPoints.length > 0 ? bbpPoints[bbpPoints.length - 1].t : 0;
    const waitTemps = waitingForCharge
        ? [
              ...(bbpActive ? bbpPoints : livePoints).flatMap((p) => [p.bt, p.et]),
              ...chartView.targetPoints.flatMap((p) => [p.bt, p.et]),
          ].filter((n): n is number => n != null)
        : [];
    const bbpTempMinC = Math.floor(Math.min(roastSettings.tempMinC, ...waitTemps) / 10) * 10;
    const bbpTempMaxC = Math.ceil(Math.max(roastSettings.tempMaxC, ...waitTemps) / 10) * 10;

    // ── 차트 데이터 파이프라인 ────────────────────────────────────
    const chart = useChartPipeline({
        livePoints: chartView.livePoints,
        targetCurvePoints: chartView.targetPoints,
        xMin: chartView.xMin,
        xMaxFloor: chartView.xMaxFloor,
        showRoR: roastSettings.showRoRChart,
        showControlChart: roastSettings.showControlChart,
        unit,
    });

    const { setZoomRange, setHoveredChartIndex } = chart;
    useEffect(() => {
        // End and Charge start different timelines; a BBP pan must not hide roast 00:00.
        void bbpActive;
        void charged;
        setZoomRange(null);
        setHoveredChartIndex(null);
    }, [bbpActive, charged, setZoomRange, setHoveredChartIndex]);

    const fcDualMarkEnabled = roastSettings.fcDualMarkEnabled;
    const liveDev = useMemo(() => calcDevTime(logEntries, elapsed), [logEntries, elapsed]);
    const { devTimeOnly, dtrPct, rollingDevTimeOnly, rollingDtrPct, roastDurationSec } = liveDev;

    // 라이프사이클과 하위 훅 사이 순환 의존성을 refs로 분리
    const resetAutoDetectionRef = useRef<() => void>(() => {});
    const disableAutoChargeRef = useRef<() => void>(() => {});
    const disableAutoDropRef = useRef<() => void>(() => {});
    const rearmAutoChargeRef = useRef<() => void>(() => {});
    const triggerChargeRef = useRef<(bt?: number | null, chargeTimeMs?: number) => void>(() => {});

    const lifecycle = useRoastLifecycle({
        phase,
        sidecarConnected,
        rawBT,
        unit,
        logEntries,
        timeStr,
        enterStandby,
        enterPreheating,
        setConnected,
        setIsRunning,
        resetStore,
        resetAutoDetectionRef,
        disableAutoChargeRef,
        disableAutoDropRef,
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
    const completedRestore = useCompletedRoastStore((s) => s.restore);
    const completedSubmitted = useCompletedRoastStore((s) => s.submitted);
    const dropCancelable =
        Boolean(completedRestore) &&
        !completedSubmitted &&
        !(charged && sessionId != null && sessionId !== completedRestore?.sessionId);

    const applyDropRef = useRef<(onset?: { timeSec: number; bt: number }) => void>(() => {});

    const {
        triggerCharge: startChargeAction,
        handleAutoDrop,
        handleTurningPoint,
    } = useRoastActions({
        unit,
        rawBT,
        setLogEntries,
        setIsRunning,
        onDrop: (onset) => applyDropRef.current(onset),
        storeStartCharge,
        roastStartTimeRef,
    });

    const triggerCharge = useCallback(
        (bt?: number | null, chargeTimeMs?: number) => {
            startChargeAction(bt, chargeTimeMs);
            useCompletedRoastStore.getState().lockAfterCharge(useRoastingStore.getState().sessionId);
            // Rearm auto Drop for this batch only. Drop's reset would re-arm too early (#484).
            resetAutoDetectionRef.current?.();
        },
        [startChargeAction],
    );

    const {
        turningPoints,
        confirmedTP,
        resetAutoDetection,
        disableAutoCharge,
        rearmAutoCharge,
        holdAutoChargeUntilRecovery,
        disableAutoDrop,
    } = useAutoDetection({
        livePoints,
        onAutoCharge: triggerCharge,
        onAutoDrop: handleAutoDrop,
        onTurningPoint: handleTurningPoint,
        autoChargeEnabled: roastSettings.autoChargeEnabled,
        autoChargeMode: roastSettings.autoChargeMode,
        pollIntervalMs,
        autoDropEnabled: roastSettings.autoDropEnabled,
        autoDropMode: roastSettings.autoDropMode,
        yellowTempC: roastSettings.yellowTempC,
        unit,
        markEvent,
        logEntries,
        autoYellowEnabled: roastSettings.autoYellowEnabled,
    });

    const applyDrop = useCallback(
        (onset?: { timeSec: number; bt: number }) => {
            lifecycle.finishDrop({
                livePoints,
                onset,
                commitSummary: (summary) => {
                    saveFlow.confirmEndRoast({
                        ...summary,
                        selectedBeanId,
                        planBatchHandoff,
                        handoffBeanName,
                    });
                },
                holdAutoChargeUntilRecovery,
            });
        },
        [
            lifecycle,
            livePoints,
            saveFlow,
            selectedBeanId,
            planBatchHandoff,
            handoffBeanName,
            holdAutoChargeUntilRecovery,
        ],
    );
    useLayoutEffect(() => {
        applyDropRef.current = applyDrop;
    }, [applyDrop]);

    const markDrop = useCallback(() => {
        applyDrop();
    }, [applyDrop]);

    useEffect(() => {
        resetAutoDetectionRef.current = resetAutoDetection;
        disableAutoChargeRef.current = disableAutoCharge;
        disableAutoDropRef.current = disableAutoDrop;
        rearmAutoChargeRef.current = rearmAutoCharge;
        triggerChargeRef.current = triggerCharge;
    }, [resetAutoDetection, disableAutoCharge, disableAutoDrop, rearmAutoCharge, triggerCharge]);

    const [preheatMountEpoch] = useState(takePreheatMountEpoch);
    const wasPreheatVisibleRef = useRef(false);
    const reloadRestartedRef = useRef(false);
    const isActiveRef = useRef(isActive);
    useLayoutEffect(() => {
        isActiveRef.current = isActive;
    }, [isActive]);

    const recoverLiveBbp = lifecycle.recoverLiveBbp;
    useEffect(() => {
        recoverLiveBbp();
    }, [recoverLiveBbp]);
    useEffect(() => {
        const justShown = isActive && !wasPreheatVisibleRef.current;
        wasPreheatVisibleRef.current = isActive;
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        const decision = chartOnlyPreheatDecision({
            visible: isActive,
            justShown,
            bbp: useBbpStore.getState(),
            bootMs: chartOnlyPreheatBootMs,
            mountEpoch: preheatMountEpoch,
            phase,
            awaitingNextCharge,
            bbpEnabled,
            navigationType: nav?.type,
            reloadConsumed: reloadRestartedRef.current,
        });
        if (decision === 'abort') {
            useBbpStore.getState().abort();
            return;
        }
        if (decision === 'begin') {
            if (nav?.type === 'reload') reloadRestartedRef.current = true;
            useBbpStore.getState().begin(Date.now(), [], false);
            noteChartOnlyPreheatMount(preheatMountEpoch);
        }
    }, [isActive, bbpEnabled, awaitingNextCharge, phase, preheatMountEpoch]);
    useEffect(() => {
        const onPageShow = (event: PageTransitionEvent) => {
            const roast = useRoastingStore.getState();
            const bbp = useBbpStore.getState();
            const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
            if (
                !shouldResetChartOnlyPreheatOnPageRestore(
                    event.persisted,
                    bbp,
                    roast.phase,
                    roast.awaitingNextCharge,
                    nav?.type,
                )
            )
                return;
            // Hidden shell: drop the restored curve. Showing the view begins a new one.
            if (!isActiveRef.current) {
                useBbpStore.getState().abort();
                return;
            }
            reloadRestartedRef.current = true;
            useBbpStore.getState().begin(Date.now(), [], false);
            noteChartOnlyPreheatMount(preheatMountEpoch);
        };
        window.addEventListener('pageshow', onPageShow);
        return () => window.removeEventListener('pageshow', onPageShow);
    }, [preheatMountEpoch]);

    const timeAlerts = useMemo(
        () => ({
            afterChargeMin: roastSettings.alertAfterChargeEnabled ? roastSettings.alertAfterChargeMin : null,
            beforeFcMin: roastSettings.alertBeforeFcEnabled ? roastSettings.alertBeforeFcMin : null,
            beforeDropMin: roastSettings.alertBeforeDropEnabled ? roastSettings.alertBeforeDropMin : null,
            afterDropMin: roastSettings.alertAfterDropEnabled ? roastSettings.alertAfterDropMin : null,
        }),
        [
            roastSettings.alertAfterChargeEnabled,
            roastSettings.alertAfterChargeMin,
            roastSettings.alertBeforeFcEnabled,
            roastSettings.alertBeforeFcMin,
            roastSettings.alertBeforeDropEnabled,
            roastSettings.alertBeforeDropMin,
            roastSettings.alertAfterDropEnabled,
            roastSettings.alertAfterDropMin,
        ],
    );

    const activeAlerts = useRoastAlerts({
        enabled: roastSettings.alertsEnabled,
        soundEnabled: roastSettings.alertSoundEnabled,
        soundKind: roastSettings.alertSoundKind,
        rorCrashCPerMin: roastSettings.alertRorCrashCPerMin,
        btMaxC: roastSettings.alertBtMaxC,
        afterTurningPoint: turningPoints.length > 0,
        logEntries,
        timeAlerts,
        referenceFcStartSec,
        referenceDropSec: replayDropTime,
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
        if (awaitingNextCharge || bbpActive) return;
        lifecycle.resetActiveRoast();
    }, [sidecarConnected, phase, awaitingNextCharge, bbpActive, lifecycle.resetActiveRoast]);

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
        let prompting = false;
        void win
            .onCloseRequested(async (e) => {
                if (!hasUnsavedRoastRef.current) return;
                // 다이얼로그가 떠 있는 동안의 재진입은 닫지 않는다.
                if (prompting) {
                    e.preventDefault();
                    return;
                }
                prompting = true;
                try {
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
                    if (!ok) {
                        e.preventDefault();
                        return;
                    }
                    const sid = useRoastingStore.getState().sessionId;
                    if (sid) {
                        try {
                            await flushTsv(sid);
                        } catch (err) {
                            logger.capture(err, { scope: 'activeRoast.flushOnClose' });
                            // flush failure must not block window close
                        }
                    }
                    // 확인이면 preventDefault 하지 않는다. Tauri 2는 JS 리스너가 있으면
                    // 네이티브 close를 이미 취소하고, preventDefault가 없을 때만 destroy() 한다.
                    // close()+unlisten()은 리스너만 지워서 이후 빨간 버튼/Cmd+W가 무시된다.
                } catch (err) {
                    e.preventDefault();
                    logger.capture(err, { scope: 'activeRoast.closePrompt' });
                } finally {
                    prompting = false;
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
    const roastPhaseName = getRoastPhaseName(charged, phase, elapsed, logEntries, bbpChargeWait);
    const roastPhaseColor = getRoastPhaseColor(charged, roastPhaseName);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    const eventMarkers = useMemo(() => buildEventMarkers(logEntries), [logEntries, resolvedTheme]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    const phaseSegments = useMemo(
        () =>
            roastSettings.showPhaseBar ? computePhaseSegments(logEntries, roastDurationSec ?? elapsed, charged) : [],
        [roastSettings.showPhaseBar, logEntries, roastDurationSec, elapsed, charged, resolvedTheme],
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
        awaitingNextCharge,
        onToggleFullscreen: toggleFullscreen,
        onExitFullscreen: exitFullscreen,
        onEnterStandby: lifecycle.handleEnterStandby,
        onManualCharge: () => {
            void lifecycle.handleManualCharge();
        },
        onMarkEvent: markEvent,
        onCycleFc: fcDualMarkEnabled ? cycleFc : undefined,
        onMarkDrop: markDrop,
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
        if (saveFlow.flow.summaryData) {
            saveFlow.flow.reopenSummary();
            return;
        }
        if (!charged) return;
        saveFlow.flow.openEndRoast();
    }, [charged, saveFlow.flow.summaryData, saveFlow.flow.reopenSummary, saveFlow.flow.openEndRoast]);

    const confirmEndRoast = useCallback(() => {
        const summaryData = lifecycle.confirmEndRoast();
        saveFlow.confirmEndRoast({
            ...summaryData,
            selectedBeanId,
            planBatchHandoff,
            handoffBeanName,
        });
        lifecycle.resetActiveRoast({ chargeWait: true, keepHeatHold: true });
    }, [lifecycle, saveFlow, selectedBeanId, planBatchHandoff, handoffBeanName]);

    const handleCancelDrop = useCallback(() => {
        if (!lifecycle.cancelDrop()) return;
        saveFlow.flow.discardSummary();
    }, [lifecycle, saveFlow.flow]);

    const handleEventMarkerDrag = useCallback(
        (logId: string, newTimeSec: number) => {
            setLogEntries((prev) =>
                applyEventMarkerEdit(prev, logId, { timeSec: newTimeSec }, livePoints, unit, elapsed),
            );
        },
        [setLogEntries, livePoints, unit, elapsed],
    );

    const handleEventMarkerEdit = useCallback(
        (logId: string, patch: { timeSec?: number; note?: string }) => {
            setLogEntries((prev) => applyEventMarkerEdit(prev, logId, patch, livePoints, unit, elapsed));
        },
        [setLogEntries, livePoints, unit, elapsed],
    );

    const handleChartNote = useCallback(
        (body: string, timeSec: number) => {
            markEvent('Note', body, undefined, { timeSec, tempC: nearestLivePointAt(livePoints, timeSec)?.bt ?? null });
        },
        [livePoints, markEvent],
    );

    const handleHeaterCommitted = useCallback(
        (value: number, heaterUnit: string) => {
            if (!Number.isFinite(value) || !charged || roastEnded || bbpActive) return;
            markEvent('Heater', `${value}${heaterUnit}`);
        },
        [bbpActive, charged, markEvent, roastEnded],
    );

    const machineControl = useMachineControlComposition({
        sidecarConnected,
        reconnecting,
        liveData,
        pidRuntime,
        roastFinished: heatHoldAfterDrop || roastEnded || logEntries.some((e) => e.event === 'Drop'),
        pidDropBehavior: roastSettings.pidDropBehavior,
        replayPoints,
        replayMachineMismatch,
        replayDropTime,
        replayHeaterEvents: targetProfile?.heater_events,
        liveBt: rawBT,
        elapsed,
        roasting: phase === 'roasting',
        confirmedTurningPoint: confirmedTP,
        observationQuality,
        lastValidReceivedAtMs,
        // eslint-disable-next-line react-hooks/purity -- fresh wall-clock must stop stale Replay before this commit's write effects
        nowMs: Date.now(),
        onHeaterCommitted: handleHeaterCommitted,
    });
    useLayoutEffect(() => {
        replayActiveRef.current = machineControl.replay.active;
        replayStopRef.current = machineControl.replay.stop;
    }, [machineControl.replay.active, machineControl.replay.stop]);

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

            {!saveFlow.flow.summaryModal && saveFlow.flow.summaryData && (
                <UnsavedRoastBanner
                    timeStr={saveFlow.flow.summaryData.totalTime}
                    cancelable={dropCancelable}
                    onReopen={saveFlow.flow.reopenSummary}
                    onCancelDrop={handleCancelDrop}
                />
            )}

            {phase === 'standby' && roastSettings.autoChargeEnabled && !hasRawTemperature && (
                <p role="status" className="text-sm text-muted-foreground">
                    {t('settings.tabs.roast.autoChargeUnavailable')}
                </p>
            )}
            {phase === 'roasting' && roastSettings.autoDropEnabled && !hasRawTemperature && (
                <p role="status" className="text-sm text-muted-foreground">
                    {t('settings.tabs.roast.autoDropUnavailable')}
                </p>
            )}

            <div
                className={`bg-(--color-roast-bg) flex flex-col min-h-0 overflow-hidden ${
                    isFullscreen
                        ? 'fixed inset-0 z-9999 h-screen w-screen py-[30px] pl-2.5 pr-2.5'
                        : 'rounded relative z-1 pl-2.5 pr-2.5 py-[30px] flex-1 dark:border dark:border-[#585d61]'
                }`}
                data-testid={bbpActive ? 'bbp-target-status' : undefined}
                data-bbp-elapsed={bbpActive ? Math.floor(bbpNowSec) : undefined}
                data-bbp-span={bbpActive ? Math.floor(chartView.bbpRange?.end ?? 0) : undefined}
            >
                <div className="flex gap-0 flex-1 min-h-0 flex-row">
                    <RoastChartContainer
                        bbpRange={chartView.bbpRange}
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
                            roastSettings.showTargetCurve && !!targetProfileId && chartView.targetPoints.length > 0
                        }
                        showTargetDeltaLabel={
                            !bbpActive &&
                            roastSettings.showTargetDeltaLabel &&
                            !!targetProfileId &&
                            targetCurvePoints.length > 0
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
                                      heatSet: chart.visibleHeatSet,
                                      heatTarget: bbpActive ? undefined : heatTarget,
                                  }
                                : undefined
                        }
                        showControlDrum={roastSettings.showControlDrum}
                        showControlHeat={roastSettings.showControlHeat}
                        showControlFan={roastSettings.showControlFan}
                        controlChartHeightPct={roastSettings.controlChartHeightPct}
                        controlYMin={roastSettings.controlYMin}
                        controlYMax={roastSettings.controlYMax}
                        tempMinC={bbpTempMinC}
                        tempMaxC={bbpTempMaxC}
                        rorYMin={roastSettings.rorYMin}
                        rorYMax={roastSettings.rorYMax}
                        elapsed={bbpActive ? bbpNowSec : elapsed}
                        charged={charged && !bbpActive}
                        eventMarkerStyle={roastSettings.eventMarkerStyle}
                        eventMarkers={bbpActive ? [] : eventMarkers}
                        turningPoints={bbpActive ? [] : turningPoints}
                        phaseSegments={bbpActive ? [] : phaseSegments}
                        showFcBand={roastSettings.showFcBand && !bbpActive}
                        unit={unit}
                        targetProfileName={targetProfile?.name}
                        onCursorIdx={handleChartCursorIdx}
                        onEventMarkerDrag={charged && !roastEnded && !bbpActive ? handleEventMarkerDrag : undefined}
                        onEventMarkerEdit={charged && !roastEnded && !bbpActive ? handleEventMarkerEdit : undefined}
                        onEventMarkerDelete={charged && !roastEnded && !bbpActive ? removeLogEntry : undefined}
                        onAddNote={charged && !roastEnded && !bbpActive ? handleChartNote : undefined}
                    />

                    {/* 그래프 | Machine Control | 온도 패널 — MC는 쓰기 가능 머신에서만 렌더 */}
                    <MachineControlPanel
                        model={machineControl}
                        liveData={liveData}
                        pidDropBehavior={roastSettings.pidDropBehavior}
                        replayPoints={replayPoints}
                        temperatureUnit={unit}
                        hotkeysEnabled={isRoastShortcutBaseEnabled({
                            isActive,
                            showEndRoastModal: saveFlow.flow.endRoastModal,
                            showSummaryModal: saveFlow.flow.summaryModal,
                            showContinueModal: saveFlow.flow.continueModal,
                        })}
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
                        rollingDevTimeStr={rollingDevTimeOnly}
                        fcDualMarkEnabled={fcDualMarkEnabled}
                        fcDualUnwind={fcDualUnwind}
                        logEntries={logEntries}
                        pressedButtons={pressedButtons}
                        roastLogDisplayEntries={roastLogDisplayEntries}
                        noteInput={noteInput}
                        onNoteChange={setNoteInput}
                        onNoteSubmit={handleNoteSubmit}
                        onMarkEvent={markEvent}
                        onCycleFc={cycleFc}
                        onHandleDrop={markDrop}
                        onRemoveLogEntry={removeLogEntry}
                        onEnterStandby={lifecycle.handleEnterStandby}
                        onManualCharge={lifecycle.handleManualCharge}
                        onEndRoast={handleEndRoastClick}
                        bbpTimer={bbpTimer}
                        bbpChargeWait={bbpChargeWait}
                    />
                </div>
            </div>

            <ReplayProfileChangeModal
                open={profileChangeOpen}
                onCancel={cancelReplayProfileChange}
                onConfirm={confirmReplayProfileChange}
            />
            <EndRoastModal
                open={saveFlow.flow.endRoastModal}
                timeStr={timeStr}
                onClose={saveFlow.flow.closeEndRoast}
                onConfirm={confirmEndRoast}
            />
            <RoastSummaryModal
                open={saveFlow.flow.summaryModal}
                summaryData={saveFlow.flow.summaryData}
                isSaving={saveFlow.isSaving}
                ambientTemp={weatherData?.temperature}
                ambientHumidity={weatherData?.humidity}
                selectedBeanId={saveFlow.flow.summaryData?.selectedBeanId ?? null}
                planBatchHandoff={saveFlow.flow.summaryData?.planBatchHandoff ?? null}
                fallbackBeanName={saveFlow.flow.summaryData?.handoffBeanName ?? null}
                onClose={saveFlow.flow.closeSummary}
                onDiscard={() => {
                    saveFlow.discardSummary();
                }}
                onSave={saveFlow.handleSave}
            />

            <PlanBatchContinueModal
                show={saveFlow.flow.continueModal}
                candidates={saveFlow.flow.continueCandidates}
                onStartNext={saveFlow.handleStartNext}
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
