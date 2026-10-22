import { useBeans } from '@entities/bean/queries';
import { useActiveWorkspace } from '@entities/organization';
import { useProfile, useUpdateProfile } from '@entities/profile';
import { useBbpCurve } from '@entities/roast';
import {
    profileHeaterEvents,
    resolveSourceSession,
    useResolvedProfileCurve,
    useRoastProfileCurve,
    useRoastProfiles,
} from '@entities/roast-profile';
import {
    btSmoothingToAlpha,
    chartSpanSec,
    computePhaseSegments,
    formatTemp,
    isRoastShortcutBaseEnabled,
    type RawTemperatureSample,
    useBbpStore,
    useBbpTimer,
    useEffectivePollIntervalMs,
    useRoastActions,
    useRoastKeyboardShortcuts,
    useRoastSettings,
} from '@features/active-roast';
import {
    bbpEventsForDisplay,
    bbpEventsFromDisplay,
    bbpStoredTime,
    makeBbpLogEntry,
} from '@features/active-roast/lib/bbp-events';
import { NEAREST_BT_MAX_SEC } from '@features/active-roast/lib/chart-option/markers';
import { isRemovableLogEvent, isToggleableLogEvent, TP_MARKER_ID } from '@features/active-roast/lib/constants';
import {
    applyEventMarkerEdit,
    type EventMarkerPatch,
    nearestLivePointAt,
    upsertReviewTurningPoint,
} from '@features/active-roast/lib/event-marker-drag';
import { dropControlRole, parseControlMarkerLogId } from '@features/active-roast/lib/fan-drum-markers';
import { withoutLogEvent } from '@features/active-roast/lib/fc-dual-mark';
import { controlValuesWithoutRepeatHeater, isRepeatHeaterCommit } from '@features/active-roast/lib/repeat-heater';
import { isReviewDeletableEvent } from '@features/active-roast/lib/review-record-events';
import { logEntryTimeSec, parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { detectTurningPoints } from '@features/active-roast/lib/turningPoints';
import { selectDropCancelable, selectReviewSnapshot, selectRoastSelection } from '@features/active-roast/model/batch';
import { isChargedPhase, useRoastingStore } from '@features/active-roast/model/status';
import { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import { useRoastAlerts } from '@features/active-roast/model/useRoastAlerts';
import { useRoastLog } from '@features/active-roast/model/useRoastLog';
import { ActiveRoastOnboarding } from '@features/active-roast/ui/ActiveRoastOnboarding';
import { MachineControlPanel, useMachineControlComposition } from '@features/machine-control';
import { editedHeatSet, profileHeatTarget } from '@features/machine-control/lib/heater-events';
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
import type { AppliedRoastControl, RoastNoteControls } from '@shared/types/roast';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { type HistoryReference, HistoryReferencePicker } from '@widgets/history-reference/ui/HistoryReferencePicker';
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
    liveWindowTitle,
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
import { useLeadingLock } from './lib/leading-gate';
import { resolveLiveChartView } from './lib/live-chart-view';
import { buildReferenceLog } from './lib/reference-log';
import { getRoastPhaseColor, getRoastPhaseName } from './lib/roast-phase';
import { useChartKeyboard } from './model/useChartKeyboard';
import { useChartPipeline } from './model/useChartPipeline';
import { appendReviewEntry, useReviewCurveEdit } from './model/useReviewCurveEdit';
import { useRoastLifecycle } from './model/useRoastLifecycle';
import { useRoastProfileSelection } from './model/useRoastProfileSelection';
import { useRoastSaveFlow } from './model/useRoastSaveFlow';
import { useRoastSourceCandidates } from './model/useRoastSourceCandidates';
import { ActiveRoastSensorNotices } from './ui/ActiveRoastSensorNotices';
import { EndRoastModal } from './ui/EndRoastModal';
import { PlanBatchContinueModal } from './ui/PlanBatchContinueModal';
import { ReadFeedback } from './ui/ReadFeedback';
import { ReplayProfileChangeModal } from './ui/ReplayProfileChangeModal';
import { RoastChartContainer } from './ui/RoastChartContainer';
import { RoastHeader } from './ui/RoastHeader';
import { RoastSidePanel } from './ui/RoastSidePanel';
import { RoastSummaryModal } from './ui/RoastSummaryModal';

const markerRowId = (logId: string) => parseControlMarkerLogId(logId)?.id ?? logId;

interface ActiveRoastProps {
    isActive: boolean;
    onOpenRoastSettings?: () => void;
    onPlanBatchComplete?: () => void;
}

/** Chart-only preheat older than this module evaluation is not a saved Charge wait. */
const chartOnlyPreheatBootMs = Date.now();

export const ActiveRoast = ({ isActive, onOpenRoastSettings, onPlanBatchComplete }: ActiveRoastProps) => {
    const { t } = useTranslation();
    const tRef = useRef(t);
    useEffect(() => {
        tRef.current = t;
    }, [t]);
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
    const bbpEvents = useBbpStore((s) => s.events ?? []);
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
        feedbackReceivedAtMs,
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
            feedbackReceivedAtMs: s.displayObservation?.receivedAtMs ?? null,
        })),
    );
    const storeActions = useRoastingStore.getState();
    const { enterStandby, startCharge: storeStartCharge, setConnected } = storeActions;

    const charged = isChargedPhase(phase);
    const roastEnded = phase === 'ended';

    // ── 유저 + DB 프로파일 ────────────────────────────────────────
    const user = useAuthStore((s) => s.user);
    const { workspaceOwnerId } = useActiveWorkspace();
    const [historyReference, setHistoryReference] = useState<HistoryReference | null>(null);
    const [referencePickerOpen, setReferencePickerOpen] = useState(false);
    const reference = historyReference?.ownerId === workspaceOwnerId ? historyReference : null;
    const historyCurve = useRoastProfileCurve(reference?.tsvPath);
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
    const candidateProfileId = useRoastingStore((s) => selectRoastSelection(s).profileId);
    const sourceOptions = useRoastSourceCandidates(workspaceOwnerId, candidateProfileId);
    const {
        targetProfileId,
        selectedBeanId,
        selectedBlendId,
        setSelectedBlendId,
        setSelectedBeanId,
        handoffBeanName,
        setUserSelectedTarget,
    } = useRoastProfileSelection({
        isActive,
        charged,
        userProfile,
        beans,
        beansReady,
        sourceCandidates: sourceOptions.candidates,
        sourceCandidatesReady: sourceOptions.ready,
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
    const reviewSnapshot = useRoastingStore(selectReviewSnapshot);
    const reviewing = reviewSnapshot != null;
    const reviewSessionId = reviewSnapshot?.sessionId ?? null;
    const { applyReviewLog, reviewSaveError, reviewHeaterEvents } = useReviewCurveEdit(reviewSessionId);
    const curvePoints = reviewSnapshot?.livePoints ?? livePoints;
    const curveEntries = reviewSnapshot?.logEntries ?? logEntries;
    const curveElapsed = reviewSnapshot?.elapsed ?? elapsed;

    // ── 차트 데이터 준비 ──────────────────────────────────────────
    const targetProfile = useMemo(
        () => dbProfiles.find((p) => p.id === targetProfileId && p.user_id === workspaceOwnerId) ?? null,
        [dbProfiles, targetProfileId, workspaceOwnerId],
    );
    const {
        points: targetCurvePoints,
        isLoading: curveLoading,
        isError: curveError,
    } = useResolvedProfileCurve(targetProfile);
    const historyPoints = historyCurve.data ?? [];
    const backgroundCurvePoints = reference ? historyPoints : targetCurvePoints;
    const replayPoints = replayPointsForProfile(
        reference?.id ?? targetProfileId,
        reference ? historyCurve.isLoading : curveLoading,
        backgroundCurvePoints,
    );
    const sourceSession = resolveSourceSession(targetProfile?.source_session);
    const waitingForCharge = isWaitingForCharge(bbpActive, charged);
    const bbpTarget = useBbpCurve(
        workspaceOwnerId,
        reference?.id ?? targetProfile?.source_session_id ?? null,
        reference ? reference.bbpPath : sourceSession?.bbp_tsv_path,
        waitingForCharge,
    );
    // Replay 컷오프는 레퍼런스의 Drop 마크다. duration_sec는 End 확정 시각(store elapsed)이라
    // Drop→End 사이 쿨다운 조작(다음 배치 예열용 가스 올림)이 재생 계획에 섞인다.
    // 히스토리 기록은 그 자체로 프로파일 역할이다. 곡선, 화력, Drop/TP는 그 기록에서 온다.
    const sourceEvents = useMemo(
        () =>
            parseStoredRoastEvents(
                reference ? reference.events : resolveSourceSession(targetProfile?.source_session)?.events,
            ),
        [reference, targetProfile],
    );
    const replayDropTime = useMemo(
        () =>
            sourceEvents.find((e) => e.type === 'Drop')?.time_sec ??
            (reference ? reference.durationSec : targetProfile?.duration_sec) ??
            null,
        [sourceEvents, reference, targetProfile?.duration_sec],
    );
    const referenceTpTime = useMemo(() => sourceEvents.find((e) => e.type === 'TP')?.time_sec ?? null, [sourceEvents]);
    const heatEvents = reference ? reference.heaterEvents : profileHeaterEvents(targetProfile);
    const referenceLog = useMemo(() => {
        const name = reference?.name ?? targetProfile?.name;
        if (!name) return undefined;
        return {
            name,
            entries: buildReferenceLog(sourceEvents, backgroundCurvePoints, unit, heatEvents),
            loading: reference ? historyCurve.isLoading : curveLoading,
            error: reference ? historyCurve.isError : curveError,
        };
    }, [
        reference,
        targetProfile,
        sourceEvents,
        backgroundCurvePoints,
        unit,
        heatEvents,
        historyCurve.isLoading,
        historyCurve.isError,
        curveLoading,
        curveError,
    ]);
    const heatTarget = useMemo(() => {
        if (!reference && !targetProfile) return undefined;
        return profileHeatTarget(backgroundCurvePoints, replayDropTime, heatEvents, referenceTpTime);
    }, [reference, targetProfile, backgroundCurvePoints, replayDropTime, heatEvents, referenceTpTime]);
    const referenceFcStartSec = useMemo(
        () => sourceEvents.find((e) => e.type === 'FC Start')?.time_sec ?? null,
        [sourceEvents],
    );

    // 기존 Standard 기록은 같은 머신 ID의 W60 키 마이그레이션 뒤에도 재생한다.
    const referenceKey = (reference ? reference.machineKey : targetProfile?.machine_roaster_key) ?? null;
    const currentKey = machineSnapshot?.machine_roaster_key ?? null;
    const replayMachineMismatch = isReplayMachineMismatch(
        referenceKey,
        currentKey,
        reference ? reference.machineId : targetProfile?.machine_id,
        machineSnapshot?.machine_id,
    );
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
                bbpActive: reviewing ? false : bbpEnabled && bbpActive,
                charged,
                livePoints: curvePoints,
                bbpPoints,
                roastTarget: backgroundCurvePoints,
                bbpTarget: bbpTarget.data ?? [],
                bbpTargetError: bbpTarget.isError,
            }),
        [
            bbpActive,
            bbpEnabled,
            bbpPoints,
            bbpTarget.data,
            bbpTarget.isError,
            charged,
            curvePoints,
            reviewing,
            backgroundCurvePoints,
        ],
    );
    const bbpEventOrigin = chartView.eventTimeOrigin;
    const bbpChartEntries = useMemo(
        () => (bbpActive && !reviewing ? bbpEventsForDisplay(bbpEvents, bbpEventOrigin) : curveEntries),
        [bbpActive, bbpEventOrigin, bbpEvents, curveEntries, reviewing],
    );
    const bbpNowSec = latestSampleTime(bbpPoints);
    const { tempMinC: bbpTempMinC, tempMaxC: bbpTempMaxC } = chargeWaitTempBand({
        waiting: waitingForCharge,
        bbpActive: reviewing ? false : bbpActive,
        bbpPoints,
        livePoints: curvePoints,
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
        void reviewing;
        setZoomRange(null);
        setHoveredChartIndex(null);
    }, [bbpActive, charged, reviewing, setZoomRange, setHoveredChartIndex]);

    const fcDualMarkEnabled = roastSettings.fcDualMarkEnabled;
    // Drop clears the live clock to 0. 0 is a real duration, so the ended screen must keep its own log.
    const devEntries = reviewing ? curveEntries : logEntries;
    const devElapsed = reviewing ? curveElapsed : elapsed;
    const liveDev = useMemo(() => calcDevTime(devEntries, devElapsed), [devEntries, devElapsed]);
    const { devTimeOnly, dtrPct, rollingDevTimeOnly, rollingDtrPct, roastDurationSec } = liveDev;

    // 라이프사이클과 하위 훅 사이 순환 의존성을 refs로 분리
    const resetAutoDetectionRef = useRef<() => void>(() => {});
    const disableAutoChargeRef = useRef<() => void>(() => {});
    const disableAutoDropRef = useRef<() => void>(() => {});
    const rearmAutoChargeRef = useRef<() => void>(() => {});
    const triggerChargeRef = useRef<(bt?: number | null, origin?: number | RawTemperatureSample) => void>(() => {});

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
    const historyTargetRef = useRef(reference);
    useEffect(() => {
        historyTargetRef.current = reference;
    }, [reference]);
    const saveFlow = useRoastSaveFlow({
        rawBT,
        ambientTemperature: weatherData?.temperature,
        ambientHumidity: weatherData?.humidity,
        onResetActiveRoast: lifecycle.resetActiveRoast,
        savedProfileId: () => (historyTargetRef.current ? null : undefined),
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
        (bt?: number | null, origin?: number | RawTemperatureSample) => {
            startChargeAction(bt, origin);
            // Rearm auto Drop for this batch only. Drop's reset would re-arm too early (#484).
            resetAutoDetectionRef.current?.();
        },
        [startChargeAction],
    );

    const {
        turningPoints,
        confirmedTP,
        moveTurningPoint,
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
            return lifecycle.finishDrop({
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

    const chargeLock = useLeadingLock(2000);
    const markCharge = useCallback(() => {
        chargeLock.run(() => {
            void lifecycle.handleManualCharge();
        });
    }, [chargeLock.run, lifecycle.handleManualCharge]);
    // This slot is return, then Charge. One lock covers the mash across that swap.
    const dismissReview = useCallback(() => {
        chargeLock.run(() => useRoastingStore.getState().dismissCompletedReview());
    }, [chargeLock.run]);

    useEffect(() => {
        resetAutoDetectionRef.current = resetAutoDetection;
        disableAutoChargeRef.current = disableAutoCharge;
        disableAutoDropRef.current = disableAutoDrop;
        rearmAutoChargeRef.current = rearmAutoCharge;
        triggerChargeRef.current = triggerCharge;
    }, [resetAutoDetection, disableAutoCharge, disableAutoDrop, rearmAutoCharge, triggerCharge]);

    const [preheatMountEpoch] = useState(takePreheatMountEpoch);
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
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        const decision = chartOnlyPreheatDecision({
            visible: isActive,
            bbp: useBbpStore.getState(),
            bootMs: chartOnlyPreheatBootMs,
            mountEpoch: preheatMountEpoch,
            phase,
            awaitingNextCharge,
            bbpEnabled,
            navigationType: nav?.type,
            reloadConsumed: reloadRestartedRef.current,
        });
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
                et_display_ema_alpha: btSmoothingToAlpha(roastSettings.etSmoothing),
                ror_ema_alpha: btSmoothingToAlpha(roastSettings.rorSmoothing),
                et_ror_ema_alpha: btSmoothingToAlpha(roastSettings.etRorSmoothing),
            })
            .catch(() => {});
    }, [
        sidecarConnected,
        roastSettings.rorSpanSec,
        roastSettings.btSmoothing,
        roastSettings.etSmoothing,
        roastSettings.rorSmoothing,
        roastSettings.etRorSmoothing,
    ]);

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
                    const translate = tRef.current;
                    const ok = await ask(
                        running
                            ? translate('activeRoast.dialogs.roastInProgressMsg')
                            : translate('activeRoast.dialogs.unsavedCloseMsg'),
                        {
                            title: translate('activeRoast.dialogs.roastInProgressTitle'),
                            kind: 'warning',
                            okLabel: translate('activeRoast.dialogs.end'),
                            cancelLabel: translate('activeRoast.dialogs.cancel'),
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
        void getCurrentWindow().setTitle(
            liveWindowTitle({
                bbpElapsed: bbpTimer,
                btLabel: formatTemp(rawBT, unit),
                etLabel: formatTemp(rawET, unit),
                roastElapsed: timeStr,
                activePhase: phase === 'roasting' || phase === 'preheating' || phase === 'standby',
            }),
        );
    }, [phase, rawBT, rawET, timeStr, unit, bbpTimer]);

    // ── 단계 표시 및 파생값 ──────────────────────────────────────
    const roastPhaseName = getRoastPhaseName(charged, phase, elapsed, logEntries, bbpChargeWait);
    const roastPhaseColor = getRoastPhaseColor(charged, roastPhaseName);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    const eventMarkers = useMemo(
        () => [
            ...buildEventMarkers(bbpChartEntries),
            ...((!bbpActive || reviewing) && roastSettings.showTargetCurve && roastSettings.showProfileHeat
                ? (referenceLog?.entries ?? []).flatMap((entry) =>
                      entry.event === 'Heater' && entry.timeSec != null
                          ? [
                                {
                                    reference: true,
                                    timeSec: entry.timeSec,
                                    event: entry.event,
                                    color: '',
                                    timeStr: entry.time,
                                    temp: entry.temp,
                                    tempC: entry.tempC,
                                    note: entry.note,
                                },
                            ]
                          : [],
                  )
                : []),
        ],
        [
            bbpChartEntries,
            bbpActive,
            reviewing,
            referenceLog,
            roastSettings.showTargetCurve,
            roastSettings.showProfileHeat,
            resolvedTheme,
        ],
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    const phaseSegments = useMemo(
        () =>
            roastSettings.showPhaseBar
                ? computePhaseSegments(curveEntries, roastDurationSec ?? curveElapsed, reviewing || charged)
                : [],
        [roastSettings.showPhaseBar, curveEntries, roastDurationSec, curveElapsed, charged, reviewing, resolvedTheme],
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
        onManualCharge: markCharge,
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

    const placeTurningPoint = useCallback(
        (timeSec: number) => {
            const nearest = nearestLivePointAt(livePoints, timeSec);
            const temp = nearest?.bt ?? confirmedTP?.temp ?? turningPoints[0]?.temp;
            if (temp == null || !Number.isFinite(temp)) return;
            moveTurningPoint(timeSec, temp);
        },
        [confirmedTP, livePoints, moveTurningPoint, turningPoints],
    );

    const frozenLogEdit = useCallback(
        (next: Parameters<typeof applyReviewLog>[0]) => {
            applyReviewLog(next);
        },
        [applyReviewLog],
    );

    const editBbpMarkers = useCallback(
        (logId: string, patch: EventMarkerPatch) => {
            const origin = chartView.eventTimeOrigin;
            const displayNow = Math.max(0, bbpNowSec - origin);
            const display = bbpEventsForDisplay(useBbpStore.getState().events, origin);
            const next = applyEventMarkerEdit(display, logId, patch, chartView.livePoints, unit, displayNow);
            useBbpStore
                .getState()
                .setEvents((prev) => [
                    ...prev.filter((entry) => entry.timeSec != null && entry.timeSec < origin),
                    ...bbpEventsFromDisplay(next, origin),
                ]);
        },
        [bbpNowSec, chartView.eventTimeOrigin, chartView.livePoints, unit],
    );

    const handleEventMarkerDrag = useCallback(
        (logId: string, newTimeSec: number) => {
            const frozen = selectReviewSnapshot(useRoastingStore.getState());
            if (frozen) {
                if (logId === TP_MARKER_ID) {
                    frozenLogEdit(
                        upsertReviewTurningPoint(
                            frozen.logEntries,
                            newTimeSec,
                            frozen.livePoints,
                            unit,
                            frozen.elapsed,
                        ),
                    );
                    return;
                }
                const target = frozen.logEntries.find((entry) => entry.id === markerRowId(logId));
                if (!target || target.event === 'Charge' || target.event === 'Drop') return;
                frozenLogEdit(
                    applyEventMarkerEdit(
                        frozen.logEntries,
                        logId,
                        { timeSec: newTimeSec },
                        frozen.livePoints,
                        unit,
                        frozen.elapsed,
                    ),
                );
                return;
            }
            if (logId === TP_MARKER_ID) {
                placeTurningPoint(newTimeSec);
                return;
            }
            if (bbpActive) {
                editBbpMarkers(logId, { timeSec: newTimeSec });
                return;
            }
            setLogEntries((prev) =>
                applyEventMarkerEdit(prev, logId, { timeSec: newTimeSec }, livePoints, unit, elapsed),
            );
        },
        [bbpActive, editBbpMarkers, elapsed, frozenLogEdit, livePoints, placeTurningPoint, setLogEntries, unit],
    );

    const handleEventMarkerEdit = useCallback(
        (logId: string, patch: EventMarkerPatch) => {
            const frozen = selectReviewSnapshot(useRoastingStore.getState());
            if (frozen) {
                if (logId === TP_MARKER_ID) {
                    if (patch.timeSec != null) {
                        frozenLogEdit(
                            upsertReviewTurningPoint(
                                frozen.logEntries,
                                patch.timeSec,
                                frozen.livePoints,
                                unit,
                                frozen.elapsed,
                            ),
                        );
                    }
                    return;
                }
                const target = frozen.logEntries.find((entry) => entry.id === markerRowId(logId));
                if (!target || target.event === 'Charge' || target.event === 'Drop') return;
                frozenLogEdit(
                    applyEventMarkerEdit(frozen.logEntries, logId, patch, frozen.livePoints, unit, frozen.elapsed),
                );
                return;
            }
            if (logId === TP_MARKER_ID) {
                if (patch.timeSec != null) placeTurningPoint(patch.timeSec);
                return;
            }
            if (bbpActive) {
                editBbpMarkers(logId, patch);
                return;
            }
            setLogEntries((prev) => applyEventMarkerEdit(prev, logId, patch, livePoints, unit, elapsed));
        },
        [bbpActive, editBbpMarkers, elapsed, frozenLogEdit, livePoints, placeTurningPoint, setLogEntries, unit],
    );

    const handleChartNote = useCallback(
        (body: string, timeSec: number, controls?: RoastNoteControls) => {
            const frozen = selectReviewSnapshot(useRoastingStore.getState());
            if (frozen) {
                const nearest = nearestLivePointAt(frozen.livePoints, timeSec);
                const tempC = nearest && Math.abs(nearest.time - timeSec) <= NEAREST_BT_MAX_SEC ? nearest.bt : null;
                frozenLogEdit(appendReviewEntry(frozen.logEntries, 'Note', body, timeSec, tempC, unit, controls));
                return;
            }
            if (bbpActive) {
                const nearest = nearestLivePointAt(chartView.livePoints, timeSec);
                const tempC = nearest && Math.abs(nearest.time - timeSec) <= NEAREST_BT_MAX_SEC ? nearest.bt : null;
                const entry = makeBbpLogEntry(
                    'Note',
                    body,
                    bbpStoredTime(timeSec, chartView.eventTimeOrigin),
                    tempC,
                    unit,
                    controls,
                );
                if (entry) useBbpStore.getState().setEvents((prev) => [...prev, entry]);
                return;
            }
            const nearest = nearestLivePointAt(livePoints, timeSec);
            const tempC = nearest && Math.abs(nearest.time - timeSec) <= NEAREST_BT_MAX_SEC ? nearest.bt : null;
            markEvent('Note', body, undefined, { timeSec, tempC }, controls);
        },
        [bbpActive, chartView.eventTimeOrigin, chartView.livePoints, frozenLogEdit, livePoints, markEvent, unit],
    );

    const handleHeaterCommitted = useCallback(
        (value: number, heaterUnit: string) => {
            if (!Number.isFinite(value) || roastEnded) return;
            if (bbpActive) {
                const events = useBbpStore.getState().events;
                if (isRepeatHeaterCommit(events, value)) return;
                const displayNow = Math.max(0, bbpNowSec - chartView.eventTimeOrigin);
                const nearest = nearestLivePointAt(chartView.livePoints, displayNow);
                const entry = makeBbpLogEntry('Heater', `${value}${heaterUnit}`, bbpNowSec, nearest?.bt ?? rawBT, unit);
                if (entry) useBbpStore.getState().setEvents((prev) => [...prev, entry]);
                return;
            }
            if (!charged) return;
            const entries = useRoastingStore.getState().logState.entries;
            if (isRepeatHeaterCommit(entries, value)) return;
            markEvent('Heater', `${value}${heaterUnit}`);
        },
        [
            bbpActive,
            bbpNowSec,
            charged,
            chartView.eventTimeOrigin,
            chartView.livePoints,
            markEvent,
            rawBT,
            roastEnded,
            unit,
        ],
    );

    const handleReviewMoveEvent = useCallback(
        (event: string, timeSec: number) => {
            const frozen = selectReviewSnapshot(useRoastingStore.getState());
            if (!frozen || event === 'Charge' || event === 'Drop') return;
            const target = frozen.logEntries.find((entry) => entry.event === event && entry.id);
            if (!target?.id) return;
            frozenLogEdit(
                applyEventMarkerEdit(
                    frozen.logEntries,
                    target.id,
                    { timeSec },
                    frozen.livePoints,
                    unit,
                    frozen.elapsed,
                ),
            );
        },
        [frozenLogEdit, unit],
    );

    const handleChartEvent = useCallback(
        (event: string, timeSec: number) => {
            const frozen = selectReviewSnapshot(useRoastingStore.getState());
            if (frozen) {
                const nearest = nearestLivePointAt(frozen.livePoints, timeSec);
                const tempC = nearest && Math.abs(nearest.time - timeSec) <= NEAREST_BT_MAX_SEC ? nearest.bt : null;
                frozenLogEdit(appendReviewEntry(frozen.logEntries, event, '', timeSec, tempC, unit));
                return;
            }
            if (!charged || roastEnded || bbpActive) return;
            const nearest = nearestLivePointAt(livePoints, timeSec);
            const tempC = nearest && Math.abs(nearest.time - timeSec) <= NEAREST_BT_MAX_SEC ? nearest.bt : null;
            markEvent(event, '', undefined, { timeSec, tempC });
        },
        [bbpActive, charged, frozenLogEdit, livePoints, markEvent, roastEnded, unit],
    );

    const removeCurveEntry = useCallback(
        (id: string) => {
            const frozen = selectReviewSnapshot(useRoastingStore.getState());
            if (bbpActive && !frozen) {
                useBbpStore.getState().setEvents((prev) => {
                    if (parseControlMarkerLogId(id)) return dropControlRole(prev, id) ?? prev;
                    const target = prev.find((entry) => entry.id === id);
                    if (!target || !isRemovableLogEvent(target.event)) return prev;
                    return prev.filter((entry) => entry.id !== id);
                });
                return;
            }
            if (parseControlMarkerLogId(id)) {
                const source = frozen?.logEntries ?? useRoastingStore.getState().logState.entries;
                const next = dropControlRole(source, id);
                if (!next) return;
                if (frozen) frozenLogEdit(next);
                else setLogEntries(next);
                return;
            }
            if (frozen) {
                const target = frozen.logEntries.find((entry) => entry.id === id);
                if (!target || !isReviewDeletableEvent(target.event)) return;
                frozenLogEdit(
                    isToggleableLogEvent(target.event)
                        ? withoutLogEvent(frozen.logEntries, target.event)
                        : frozen.logEntries.filter((entry) => entry.id !== id),
                );
                return;
            }
            removeLogEntry(id);
        },
        [bbpActive, frozenLogEdit, removeLogEntry, setLogEntries],
    );

    const handleControlApplied = useCallback(
        (applied: AppliedRoastControl) => {
            const commanded: AppliedRoastControl = {};
            for (const role of ['heater', 'fan', 'drum'] as const) {
                const value = applied[role];
                if (value !== undefined && Number.isFinite(value)) commanded[role] = value;
            }
            if (Object.keys(commanded).length === 0) return;
            if (bbpActive) {
                const events = useBbpStore.getState().events;
                const values = controlValuesWithoutRepeatHeater(events, commanded);
                if (Object.keys(values).length === 0) return;
                const entry = makeBbpLogEntry('Control', '', bbpNowSec, null, unit, { appliedControl: values });
                if (entry) useBbpStore.getState().setEvents((prev) => [...prev, entry]);
                return;
            }
            const state = useRoastingStore.getState();
            if (state.sessionId !== sessionId || state.phase !== 'roasting') return;
            const timeSec =
                state.roastStartMs > 0 ? Math.max(0, (Date.now() - state.roastStartMs) / 1000) : state.elapsed;
            setLogEntries((entries) => {
                const values = controlValuesWithoutRepeatHeater(entries, commanded);
                if (Object.keys(values).length === 0) return entries;
                return [
                    ...entries,
                    {
                        id: crypto.randomUUID(),
                        event: 'Control',
                        time: formatElapsed(timeSec),
                        timeSec,
                        temp: '',
                        tempC: null,
                        note: '',
                        appliedControl: values,
                    },
                ];
            });
        },
        [bbpActive, bbpNowSec, sessionId, setLogEntries, unit],
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
        referenceTpTime,
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
        onApplied: handleControlApplied,
        diagnostics: { sessionId: charged ? sessionId : null, receivedAtMs: feedbackReceivedAtMs, sample: liveData },
    });
    useEffect(() => {
        if (reviewing) machineControl.replay.stop();
    }, [reviewing, machineControl.replay.stop]);
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
        const body = noteInput.trim();
        if (!body) return;
        const frozen = selectReviewSnapshot(useRoastingStore.getState());
        if (frozen) {
            const timeSec = Math.max(0, frozen.elapsed);
            const nearest = nearestLivePointAt(frozen.livePoints, timeSec);
            const tempC = nearest && Math.abs(nearest.time - timeSec) <= NEAREST_BT_MAX_SEC ? nearest.bt : null;
            frozenLogEdit(appendReviewEntry(frozen.logEntries, 'Note', body, timeSec, tempC, unit));
            setNoteInput('');
            return;
        }
        if (bbpActive) {
            const displayNow = Math.max(0, bbpNowSec - chartView.eventTimeOrigin);
            const nearest = nearestLivePointAt(chartView.livePoints, displayNow);
            const entry = makeBbpLogEntry('Note', body, bbpNowSec, nearest?.bt ?? rawBT, unit);
            if (entry) useBbpStore.getState().setEvents((prev) => [...prev, entry]);
            setNoteInput('');
            return;
        }
        markEvent('Note', body);
        setNoteInput('');
    }, [
        bbpActive,
        bbpNowSec,
        chartView.eventTimeOrigin,
        chartView.livePoints,
        frozenLogEdit,
        markEvent,
        noteInput,
        rawBT,
        unit,
    ]);

    // ── 표시용 파생값 ─────────────────────────────────────────────
    const { deltaBT, deltaET } = useMemo(() => calcDelta(livePoints, unit), [livePoints, unit]);
    const targetDelta = useMemo(
        () =>
            roastSettings.showTargetCurve && charged && !roastEnded
                ? calcTargetDelta(rawBT, backgroundCurvePoints, elapsed, unit)
                : null,
        [roastSettings.showTargetCurve, charged, roastEnded, rawBT, backgroundCurvePoints, elapsed, unit],
    );
    const roastLogDisplayEntries = useMemo(
        () => buildRoastLogDisplayEntries(bbpChartEntries, roastEnded, charged, timeStr, rawBT, roastPhaseName, unit),
        [bbpChartEntries, roastEnded, charged, timeStr, rawBT, roastPhaseName, unit],
    );
    const reviewChartTurningPoints = useMemo(() => {
        if (!reviewSnapshot) return [];
        const logged = reviewSnapshot.logEntries.find((entry) => entry.event === 'TP' && entry.tempC != null);
        const loggedTime = logged ? logEntryTimeSec(logged) : null;
        if (logged?.tempC != null && loggedTime != null) return [{ timeSec: loggedTime, temp: logged.tempC }];
        const drop = reviewSnapshot.logEntries.find((entry) => entry.event === 'Drop');
        const limit = (drop ? logEntryTimeSec(drop) : null) ?? reviewSnapshot.elapsed;
        const xs: number[] = [];
        const bt: number[] = [];
        for (const point of reviewSnapshot.livePoints) {
            if (point.time < 0 || point.time > limit || !Number.isFinite(point.bt)) continue;
            xs.push(point.time);
            bt.push(point.bt);
        }
        return detectTurningPoints(xs, bt)
            .slice(0, 1)
            .map(({ timeSec, temp }) => ({ timeSec, temp }));
    }, [reviewSnapshot]);
    const reviewHeatSet = useMemo(() => {
        if (!reviewing || reviewHeaterEvents == null) return chart.visibleHeatSet;
        const drop = curveEntries.find((entry) => entry.event === 'Drop');
        const dropTime = (drop ? logEntryTimeSec(drop) : null) ?? curveElapsed;
        const points = chart.visibleControlXs.map((t, index) => ({
            t,
            heaterSet: chart.visibleHeatSet[index] ?? null,
        }));
        return editedHeatSet(points, dropTime, reviewHeaterEvents) ?? chart.visibleHeatSet;
    }, [reviewing, reviewHeaterEvents, curveEntries, curveElapsed, chart.visibleControlXs, chart.visibleHeatSet]);
    const chartFrame = buildChartFrame({
        isFullscreen,
        bbpActive: reviewing ? false : bbpActive,
        bbpNowSec,
        bbpRange: chartView.bbpRange,
        eventTimeOrigin: chartView.eventTimeOrigin,
        bbpRecording,
        awaitingNextCharge,
        showTargetCurve: roastSettings.showTargetCurve,
        targetProfileId: reference?.id ?? targetProfileId,
        targetPointCount: chartView.targetPoints.length,
        showTargetDeltaLabel: roastSettings.showTargetDeltaLabel,
        targetCurvePointCount: backgroundCurvePoints.length,
        showControlChart: roastSettings.showControlChart,
        showControlDrum: roastSettings.showControlDrum,
        showControlHeat: roastSettings.showControlHeat,
        showControlFan: roastSettings.showControlFan,
        showProfileDrum: roastSettings.showProfileDrum,
        showProfileHeat: roastSettings.showProfileHeat,
        showProfileFan: roastSettings.showProfileFan,
        readUnits: chart.visibleReadUnits,
        referenceReadUnits: chart.visibleTargetReadUnits,
        controlXs: chart.visibleControlXs,
        drumTemp: chart.visibleDrumTemp,
        heatPower: chart.visibleHeatPower,
        fanSpeed: chart.visibleFanSpeed,
        heatSet: reviewHeatSet,
        heatTarget,
        controlChanges: bbpChartEntries.flatMap((entry) =>
            entry.event === 'Control' && entry.appliedControl
                ? [{ timeSec: entry.timeSec ?? 0, values: entry.appliedControl }]
                : [],
        ),
        referenceXs: chart.visibleTargetXs,
        referenceDrum: chart.visibleTargetDrum,
        referenceHeater: chart.visibleTargetHeater,
        referenceFan: chart.visibleTargetFan,
        elapsed: curveElapsed,
        charged,
        roastEnded,
        eventMarkers,
        turningPoints: reviewing ? reviewChartTurningPoints : turningPoints,
        phaseSegments,
        showFcBand: roastSettings.showFcBand,
        onEventMarkerDrag: handleEventMarkerDrag,
        onEventMarkerEdit: handleEventMarkerEdit,
        onEventMarkerDelete: removeCurveEntry,
        onAddNote: handleChartNote,
        onAddEvent: handleChartEvent,
        onMoveEvent: handleReviewMoveEvent,
        reviewing,
    });

    // ── 렌더 ──────────────────────────────────────────────────────
    return (
        <div
            className={`flex h-full min-h-0 flex-col gap-0 overflow-hidden pt-6 pb-3 ${
                isFullscreen ? 'px-6' : 'pl-6 pr-0'
            }`}
        >
            <RoastHeader
                phase={roastPhaseName}
                targetProfileId={targetProfileId}
                selectedBeanId={selectedBeanId}
                selectedBlendId={selectedBlendId}
                onBlendChange={setSelectedBlendId}
                sourceCandidates={sourceOptions.candidates}
                fallbackBeanName={handoffBeanName}
                onTargetProfileChange={(id) => {
                    void setUserSelectedTarget(id).then((applied) => {
                        if (applied) setHistoryReference(null);
                    });
                }}
                onBeanChange={setSelectedBeanId}
                onOpenRoastSettings={onOpenRoastSettings}
                historyReferenceName={reference?.name ?? null}
                historyReferenceFailed={Boolean(reference && historyCurve.isError)}
                onChooseHistoryReference={() => setReferencePickerOpen(true)}
                onClearHistoryReference={() => setHistoryReference(null)}
            />
            {referencePickerOpen && (
                <HistoryReferencePicker
                    key={workspaceOwnerId}
                    ownerId={workspaceOwnerId}
                    onSelect={setHistoryReference}
                    onClose={() => setReferencePickerOpen(false)}
                />
            )}

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

            <ReadFeedback />

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
                        targetEtRor={chart.visibleTargetEtRor}
                        showTargetCurve={chartFrame.showTargetCurve}
                        showProfileBt={roastSettings.showProfileBt}
                        showProfileEt={roastSettings.showProfileEt}
                        showProfileRor={roastSettings.showProfileRor}
                        showProfileEtRor={roastSettings.showProfileEtRor}
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
                        mergeControlChart={roastSettings.mergeControlChart}
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
                        targetProfileName={reference?.name ?? targetProfile?.name}
                        onCursorIdx={handleChartCursorIdx}
                        onEventMarkerDrag={chartFrame.onEventMarkerDrag}
                        onEventMarkerEdit={chartFrame.onEventMarkerEdit}
                        onEventMarkerDelete={chartFrame.onEventMarkerDelete}
                        savedReview={reviewing}
                        onAddNote={chartFrame.onAddNote}
                        onAddEvent={chartFrame.onAddEvent}
                        onMoveEvent={chartFrame.onMoveEvent}
                    />

                    {/* 그래프 | Machine Control | 온도 패널 — MC는 쓰기 가능 머신에서만 렌더 */}
                    <MachineControlPanel
                        model={machineControl}
                        liveData={liveData}
                        pidDropBehavior={roastSettings.pidDropBehavior}
                        replayPoints={replayPoints}
                        temperatureUnit={unit}
                        commandsLocked={reviewing}
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
                        logEntries={bbpChartEntries}
                        pressedButtons={pressedButtons}
                        roastLogDisplayEntries={roastLogDisplayEntries}
                        referenceLog={referenceLog}
                        noteInput={noteInput}
                        onNoteChange={setNoteInput}
                        onNoteSubmit={handleNoteSubmit}
                        onMarkEvent={markEvent}
                        onCycleFc={cycleFc}
                        onHandleDrop={markDrop}
                        onRemoveLogEntry={removeCurveEntry}
                        logEditOptions={
                            chartFrame.onEventMarkerEdit
                                ? {
                                      unit,
                                      livePoints: bbpActive && !reviewing ? chartView.livePoints : curvePoints,
                                      maxTimeSec:
                                          bbpActive && !reviewing
                                              ? Math.max(0, bbpNowSec - chartView.eventTimeOrigin)
                                              : curveElapsed,
                                      onEditEntry: handleEventMarkerEdit,
                                  }
                                : undefined
                        }
                        onEnterStandby={lifecycle.handleEnterStandby}
                        onManualCharge={markCharge}
                        chargeLocked={chargeLock.locked}
                        reviewing={reviewing}
                        onDismissReview={dismissReview}
                        reviewSaveError={reviewSaveError}
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
                bbpEnabled={bbpEnabled}
                open={saveFlow.flow.summaryModal}
                summaryData={saveFlow.flow.summaryData}
                isSaving={saveFlow.isSaving}
                ambientTemp={weatherData?.temperature}
                ambientHumidity={weatherData?.humidity}
                selectedBeanId={orNull(saveFlow.flow.summaryData?.selectedBeanId)}
                selectedBlendId={orNull(saveFlow.flow.summaryData?.selectedBlendId)}
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
