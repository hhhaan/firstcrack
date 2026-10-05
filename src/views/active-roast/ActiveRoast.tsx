import { useBeans } from '@entities/bean/queries';
import { useActiveWorkspace } from '@entities/organization';
import { useProfile, useUpdateProfile } from '@entities/profile';
import { useBbpCurve } from '@entities/roast';
import {
    profileHeaterEvents,
    resolveSourceSession,
    useResolvedProfileCurve,
    useRoastProfiles,
} from '@entities/roast-profile';
import {
    btSmoothingToAlpha,
    chartSpanSec,
    computePhaseSegments,
    formatTemp,
    isRoastShortcutBaseEnabled,
    useBbpStore,
    useBbpTimer,
    useEffectivePollIntervalMs,
    useRoastActions,
    useRoastKeyboardShortcuts,
    useRoastSettings,
} from '@features/active-roast';
import { NEAREST_BT_MAX_SEC } from '@features/active-roast/lib/chart-option/markers';
import {
    applyEventMarkerEdit,
    type EventMarkerPatch,
    nearestLivePointAt,
} from '@features/active-roast/lib/event-marker-drag';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { selectDropCancelable } from '@features/active-roast/model/batch';
import { isChargedPhase, useRoastingStore } from '@features/active-roast/model/status';
import { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import { useRoastAlerts } from '@features/active-roast/model/useRoastAlerts';
import { useRoastLog } from '@features/active-roast/model/useRoastLog';
import { ActiveRoastOnboarding } from '@features/active-roast/ui/ActiveRoastOnboarding';
import { MachineControlPanel, useMachineControlComposition } from '@features/machine-control';
import { profileHeatTarget } from '@features/machine-control/lib/heater-events';
import type { ReplayStopReason } from '@features/machine-control/model/useReplayControl';
import { useWeather } from '@shared/api/weather';
import { subscribeExplicitMachineDisconnect } from '@shared/lib/explicitMachineDisconnect';
import { FEATURE, useFeature } from '@shared/lib/features';
import { formatElapsed } from '@shared/lib/format';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { flushTsv } from '@shared/lib/tsv-writer';
import { useAuthStore } from '@shared/store/auth';
import { useThemeStore } from '@shared/store/theme';
import type { RoastNoteControls } from '@shared/types/roast';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
    autoChargeUnavailable,
    autoDropUnavailable,
    batchRoastFinished,
    bbpChargeWaitActive,
    bbpElapsedWhenEnabled,
    bbpFeatureEnabled,
    buildChartFrame,
    chargeWaitTempBand,
    cycleFcWhenEnabled,
    formatDisplayRoR,
    isReplayMachineMismatch,
    isWaitingForCharge,
    latestSampleTime,
    orEmpty,
    orNull,
    profileSelectionEpoch,
    replayPointsForProfile,
    showPendingSummary,
} from './lib/active-roast-screen';
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
import { applyExplicitDisconnectReset } from './lib/explicit-disconnect-reset';
import { resolveLiveChartView } from './lib/live-chart-view';
import { getRoastPhaseColor, getRoastPhaseName } from './lib/roast-phase';
import { useChartKeyboard } from './model/useChartKeyboard';
import { useChartPipeline } from './model/useChartPipeline';
import { useRoastLifecycle } from './model/useRoastLifecycle';
import { useRoastProfileSelection } from './model/useRoastProfileSelection';
import { useRoastSaveFlow } from './model/useRoastSaveFlow';
import { ActiveRoastSensorNotices } from './ui/ActiveRoastSensorNotices';
import { EndRoastModal } from './ui/EndRoastModal';
import { PlanBatchContinueModal } from './ui/PlanBatchContinueModal';
import { ReplayProfileChangeModal } from './ui/ReplayProfileChangeModal';
import { RoastChartContainer } from './ui/RoastChartContainer';
import { RoastHeader } from './ui/RoastHeader';
import { RoastSidePanel } from './ui/RoastSidePanel';
import { RoastSummaryModal } from './ui/RoastSummaryModal';

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
    const bbpEnabled = bbpFeatureEnabled(useFeature(FEATURE.bbp), roastSettings.bbpEnabled);
    const bbpElapsed = useBbpTimer();
    const bbpTimer = bbpElapsedWhenEnabled(bbpEnabled, bbpElapsed);
    const bbpActive = useBbpStore((s) => s.active);
    const bbpRecording = useBbpStore((s) => s.recording);
    const bbpPoints = useBbpStore((s) => s.points);
    const awaitingNextCharge = useRoastingStore((s) => s.awaitingNextCharge);
    const heatHoldAfterDrop = useRoastingStore((s) => s.heatHoldAfterDrop);
    const bbpChargeWait = bbpChargeWaitActive(bbpActive, bbpRecording, awaitingNextCharge);

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
        sessionId,
        sidecarConnected,
        reconnecting,
        machineSnapshot,
        replayBt,
        observationQuality,
        lastValidReceivedAtMs,
    } = useRoastingStore(
        useShallow((s) => ({
            phase: s.phase,
            elapsed: s.elapsed,
            liveData: s.liveData,
            pid: s.pid,
            sessionId: s.sessionId,
            sidecarConnected: s.sidecarConnected,
            reconnecting: s.reconnecting,
            machineSnapshot: s.machineSnapshot,
            replayBt: s.rawTemperature?.bt ?? null,
            observationQuality: s.observation?.quality ?? null,
            lastValidReceivedAtMs: s.observation?.lastValidReceivedAtMs ?? null,
        })),
    );
    const storeActions = useRoastingStore.getState();
    const { enterStandby, startCharge: storeStartCharge, setConnected } = storeActions;

    const charged = isChargedPhase(phase);
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
    const completeBatch = useRoastingStore((s) => s.completeBatch);

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
    const selectionEpoch = profileSelectionEpoch(workspaceOwnerId, sessionId);
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
            workspaceOwnerId,
        });

    // ── UI 상태 ───────────────────────────────────────────────────
    // 진행 중은 phase === 'roasting'. 화면 로컬 boolean을 두지 않는다.
    const isRunning = phase === 'roasting';
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

    // ── 도메인 훅 ─────────────────────────────────────────────────
    const rawBT = liveData?.bt ?? null;
    const rawET = liveData?.et ?? null;
    const timeStr = formatElapsed(elapsed);

    const { logEntries, pressedButtons, markEvent, cycleFc, fcDualUnwind, setLogEntries, removeLogEntry } = useRoastLog(
        unit,
        rawBT,
        elapsed,
    );

    const livePoints = useRoastingStore((state) => state.livePoints);

    // ── 차트 데이터 준비 ──────────────────────────────────────────
    const targetProfile = useMemo(
        () => dbProfiles.find((p) => p.id === targetProfileId && p.user_id === workspaceOwnerId) ?? null,
        [dbProfiles, targetProfileId, workspaceOwnerId],
    );
    const { points: targetCurvePoints, isLoading: curveLoading } = useResolvedProfileCurve(targetProfile);
    const replayPoints = replayPointsForProfile(targetProfileId, curveLoading, targetCurvePoints);
    const sourceSession = resolveSourceSession(targetProfile?.source_session);
    const waitingForCharge = isWaitingForCharge(bbpActive, charged);
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
        return profileHeatTarget(targetCurvePoints, replayDropTime, profileHeaterEvents(targetProfile));
    }, [targetProfile, targetCurvePoints, replayDropTime]);
    const referenceFcStartSec = useMemo(
        () => sourceEvents.find((e) => e.type === 'FC Start')?.time_sec ?? null,
        [sourceEvents],
    );

    // Replay는 같은 기기만 — 키가 양쪽 다 있고 다를 때만 차단(레거시 null 프로파일은 허용)
    const referenceKey = targetProfile?.machine_roaster_key ?? null;
    const currentKey = machineSnapshot?.machine_roaster_key ?? null;
    const replayMachineMismatch = isReplayMachineMismatch(referenceKey, currentKey);
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
    const bbpNowSec = latestSampleTime(bbpPoints);
    const { tempMinC: bbpTempMinC, tempMaxC: bbpTempMaxC } = chargeWaitTempBand({
        waiting: waitingForCharge,
        bbpActive,
        bbpPoints,
        livePoints,
        targetPoints: chartView.targetPoints,
        tempMinC: roastSettings.tempMinC,
        tempMaxC: roastSettings.tempMaxC,
    });

    // ── 차트 데이터 파이프라인 ────────────────────────────────────
    const chart = useChartPipeline({
        livePoints: chartView.livePoints,
        targetCurvePoints: chartView.targetPoints,
        xMin: chartView.xMin,
        xMaxFloor: chartView.xMaxFloor ?? chartSpanSec(roastSettings),
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
        enterStandby,
        setConnected,
        resetAutoDetectionRef,
        disableAutoChargeRef,
        disableAutoDropRef,
        rearmAutoChargeRef,
        setZoomRange: chart.setZoomRange,
        setHoveredChartIndex: chart.setHoveredChartIndex,
        triggerChargeRef,
        replayActiveRef,
    });

    // ── 날씨 데이터 ───────────────────────────────────────────────
    const { data: weatherData } = useWeather();

    // ── 모달/저장 플로우 ──────────────────────────────────────────
    const saveFlow = useRoastSaveFlow({
        rawBT,
        ambientTemperature: weatherData?.temperature,
        ambientHumidity: weatherData?.humidity,
        onResetActiveRoast: lifecycle.resetActiveRoast,
    });
    const dropCancelable = useRoastingStore(selectDropCancelable);

    const applyDropRef = useRef<(onset?: { timeSec: number; bt: number }) => void>(() => {});

    const {
        triggerCharge: startChargeAction,
        handleAutoDrop,
        handleTurningPoint,
    } = useRoastActions({
        unit,
        rawBT,
        setLogEntries,
        onDrop: (onset) => applyDropRef.current(onset),
        storeStartCharge,
    });

    const triggerCharge = useCallback(
        (bt?: number | null, chargeTimeMs?: number) => {
            startChargeAction(bt, chargeTimeMs);
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
        autoDropStartMin: roastSettings.autoDropStartMin,
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
                commitSummary: saveFlow.confirmEndRoast,
                holdAutoChargeUntilRecovery,
            });
        },
        [lifecycle, livePoints, saveFlow, holdAutoChargeUntilRecovery],
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

    // ── Effect: 온도 처리 설정을 연결/변경 시 사이드카에 전달 ────
    useEffect(() => {
        if (!sidecarConnected) return;
        sidecar
            .updateSettings({
                ror_window_sec: roastSettings.rorSpanSec,
                bt_display_ema_alpha: btSmoothingToAlpha(roastSettings.btSmoothing),
            })
            .catch(() => {});
    }, [sidecarConnected, roastSettings.rorSpanSec, roastSettings.btSmoothing]);

    // ── Effect: 링크가 끊기면 예열·대기만 초기화 ──────────────────
    // 로스팅 중 장애는 세션을 보존한다. 재연결되면 끊긴 구간만 비고 커브가 이어진다.
    // Machines에서 연결 해제 버튼을 누른 경우는 아래 구독이 곡선을 지운다.
    useEffect(() => {
        if (sidecarConnected) return;
        if (phase !== 'preheating' && phase !== 'standby') return;
        if (awaitingNextCharge || bbpActive) return;
        lifecycle.resetActiveRoast();
    }, [sidecarConnected, phase, awaitingNextCharge, bbpActive, lifecycle.resetActiveRoast]);

    useEffect(
        () =>
            subscribeExplicitMachineDisconnect(() => {
                resetAutoDetectionRef.current?.();
                applyExplicitDisconnectReset(useRoastingStore.getState().setLivePoints, setLogEntries);
                chart.setZoomRange(null);
                chart.setHoveredChartIndex(null);
            }),
        [setLogEntries, chart.setZoomRange, chart.setHoveredChartIndex],
    );

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
    const displayRoR = formatDisplayRoR(liveData?.ror, unit);

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
        onCycleFc: cycleFcWhenEnabled(fcDualMarkEnabled, cycleFc),
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
        lifecycle.confirmEndRoast(saveFlow.confirmEndRoast);
    }, [lifecycle, saveFlow]);

    const handleEventMarkerDrag = useCallback(
        (logId: string, newTimeSec: number) => {
            setLogEntries((prev) =>
                applyEventMarkerEdit(prev, logId, { timeSec: newTimeSec }, livePoints, unit, elapsed),
            );
        },
        [setLogEntries, livePoints, unit, elapsed],
    );

    const handleEventMarkerEdit = useCallback(
        (logId: string, patch: EventMarkerPatch) => {
            setLogEntries((prev) => applyEventMarkerEdit(prev, logId, patch, livePoints, unit, elapsed));
        },
        [setLogEntries, livePoints, unit, elapsed],
    );

    const handleChartNote = useCallback(
        (body: string, timeSec: number, controls?: RoastNoteControls) => {
            const nearest = nearestLivePointAt(livePoints, timeSec);
            const tempC = nearest && Math.abs(nearest.time - timeSec) <= NEAREST_BT_MAX_SEC ? nearest.bt : null;
            markEvent('Note', body, undefined, { timeSec, tempC }, controls);
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
        roastFinished: batchRoastFinished(
            heatHoldAfterDrop,
            roastEnded,
            logEntries.some((e) => e.event === 'Drop'),
        ),
        pidDropBehavior: roastSettings.pidDropBehavior,
        replayPoints,
        replayMachineMismatch,
        replayDropTime,
        replayHeaterEvents: profileHeaterEvents(targetProfile),
        liveBt: replayBt,
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

    const handleCancelDrop = useCallback(() => {
        const sessionId = saveFlow.flow.summaryData?.sessionId;
        const restore = useRoastingStore.getState().completed?.restore;
        if (!sessionId || restore?.sessionId !== sessionId) return;
        if (!lifecycle.cancelDrop(sessionId)) {
            logger.capture(new Error('Roast summary Drop cancellation failed'));
            return;
        }
        machineControl.replay.restore(restore?.replayActive ?? false);
        saveFlow.flow.closeSummary();
    }, [lifecycle, machineControl.replay, saveFlow.flow]);

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
    const chartFrame = buildChartFrame({
        isFullscreen,
        bbpActive,
        bbpNowSec,
        bbpRange: chartView.bbpRange,
        bbpRecording,
        awaitingNextCharge,
        showTargetCurve: roastSettings.showTargetCurve,
        targetProfileId,
        targetPointCount: chartView.targetPoints.length,
        showTargetDeltaLabel: roastSettings.showTargetDeltaLabel,
        targetCurvePointCount: targetCurvePoints.length,
        showControlChart: roastSettings.showControlChart,
        showControlDrum: roastSettings.showControlDrum,
        showControlHeat: roastSettings.showControlHeat,
        showControlFan: roastSettings.showControlFan,
        showProfileDrum: roastSettings.showProfileDrum,
        showProfileHeat: roastSettings.showProfileHeat,
        showProfileFan: roastSettings.showProfileFan,
        controlXs: chart.visibleControlXs,
        drumTemp: chart.visibleDrumTemp,
        heatPower: chart.visibleHeatPower,
        fanSpeed: chart.visibleFanSpeed,
        heatSet: chart.visibleHeatSet,
        heatTarget,
        referenceXs: chart.visibleTargetXs,
        referenceDrum: chart.visibleTargetDrum,
        referenceHeater: chart.visibleTargetHeater,
        referenceFan: chart.visibleTargetFan,
        elapsed,
        charged,
        roastEnded,
        eventMarkers,
        turningPoints,
        phaseSegments,
        showFcBand: roastSettings.showFcBand,
        onEventMarkerDrag: handleEventMarkerDrag,
        onEventMarkerEdit: handleEventMarkerEdit,
        onEventMarkerDelete: removeLogEntry,
        onAddNote: handleChartNote,
    });

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

            <ActiveRoastSensorNotices
                showUnsavedBanner={showPendingSummary(saveFlow.flow.summaryModal, saveFlow.flow.summaryData)}
                unsavedTime={orEmpty(saveFlow.flow.summaryData?.totalTime)}
                onReopenUnsaved={saveFlow.flow.reopenSummary}
                showAutoChargeUnavailable={autoChargeUnavailable(
                    phase,
                    roastSettings.autoChargeEnabled,
                    hasRawTemperature,
                )}
                showAutoDropUnavailable={autoDropUnavailable(phase, roastSettings.autoDropEnabled, hasRawTemperature)}
                autoChargeMessage={t('settings.tabs.roast.autoChargeUnavailable')}
                autoDropMessage={t('settings.tabs.roast.autoDropUnavailable')}
            />

            <div
                className={chartFrame.className}
                data-testid={chartFrame.testId}
                data-bbp-elapsed={chartFrame.bbpElapsed}
                data-bbp-span={chartFrame.bbpSpan}
            >
                <div className="flex gap-0 flex-1 min-h-0 flex-row">
                    <RoastChartContainer
                        bbpRange={chartFrame.bbpRange}
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
                        targetEt={chart.visibleTargetEt}
                        targetRor={chart.visibleTargetRor}
                        showTargetCurve={chartFrame.showTargetCurve}
                        showProfileBt={roastSettings.showProfileBt}
                        showProfileEt={roastSettings.showProfileEt}
                        showProfileRor={roastSettings.showProfileRor}
                        showProfileDrum={roastSettings.showProfileDrum}
                        showProfileHeat={roastSettings.showProfileHeat}
                        showProfileFan={roastSettings.showProfileFan}
                        showTargetDeltaLabel={chartFrame.showTargetDeltaLabel}
                        showET={roastSettings.showET}
                        showRoR={roastSettings.showRoRChart}
                        showRoRET={roastSettings.showRoRET}
                        controlData={chartFrame.controlData}
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
                        elapsed={chartFrame.elapsed}
                        charged={chartFrame.charged}
                        eventMarkerStyle={roastSettings.eventMarkerStyle}
                        eventMarkers={chartFrame.eventMarkers}
                        turningPoints={chartFrame.turningPoints}
                        phaseSegments={chartFrame.phaseSegments}
                        showFcBand={chartFrame.showFcBand}
                        unit={unit}
                        targetProfileName={targetProfile?.name}
                        onCursorIdx={handleChartCursorIdx}
                        onEventMarkerDrag={chartFrame.onEventMarkerDrag}
                        onEventMarkerEdit={chartFrame.onEventMarkerEdit}
                        onEventMarkerDelete={chartFrame.onEventMarkerDelete}
                        onAddNote={chartFrame.onAddNote}
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
                selectedBeanId={orNull(saveFlow.flow.summaryData?.selectedBeanId)}
                planBatchHandoff={orNull(saveFlow.flow.summaryData?.planBatchHandoff)}
                fallbackBeanName={orNull(saveFlow.flow.summaryData?.handoffBeanName)}
                onClose={saveFlow.flow.closeSummary}
                canCancelDrop={dropCancelable}
                onCancelDrop={handleCancelDrop}
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
