import { type DropOnset, planDropTransition } from '@features/active-roast/lib/drop-transition';
import { logEntryTimeSec } from '@features/active-roast/lib/serialize-roast-events';
import { formatTemp } from '@features/active-roast/lib/temperature';
import { BBP_INPROGRESS_ID, hydrateLiveBbp, useBbpStore } from '@features/active-roast/model/bbp';
import { clearPendingRoastSave } from '@features/active-roast/model/pendingRoastSave';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { useRoastSettings } from '@features/active-roast/model/settings';
import { isChargedPhase, useRoastingStore } from '@features/active-roast/model/status';
import { useBatchQuota } from '@features/active-roast/model/useBatchQuota';
import { FEATURE, useFeature, useWriteAccess } from '@shared/lib/features';
import { formatElapsed } from '@shared/lib/format';
import { logger } from '@shared/lib/logger';
import { deriveRoastMetrics } from '@shared/lib/roast-delta';
import { sidecar } from '@shared/lib/sidecar';
import { deleteBbpTsv, formatRoastTsvRow, formatTsvRows, replaceSessionTsv } from '@shared/lib/tsv-writer';
import type { LogEntry } from '@shared/types/roast';
import { message } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import { waitPhaseAfterRoastReset } from '../lib/roast-phase';
import { isDropCancelable, useCompletedRoastStore } from './completedRoast';
import type { RoastSummaryData } from './useRoastCompletionFlow';
import type { LiveRoastPoint } from './useSidecarPolling';

export interface UseRoastLifecycleParams {
    phase: string;
    sidecarConnected: boolean;
    rawBT: number | null;
    unit: TemperatureUnit;
    logEntries: LogEntry[];
    timeStr: string;
    enterStandby: () => void;
    enterPreheating: (capabilities?: string[]) => void;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    resetStore: () => void;
    resetAutoDetectionRef: React.RefObject<() => void>;
    disableAutoChargeRef: React.RefObject<() => void>;
    disableAutoDropRef: React.RefObject<() => void>;
    rearmAutoChargeRef: React.RefObject<() => void>;
    setLogEntries: (entries: LogEntry[]) => void;
    setLivePoints: (points: LiveRoastPoint[]) => void;
    setZoomRange: (range: { start: number; end: number } | null) => void;
    setHoveredChartIndex: (index: number | null) => void;
    triggerChargeRef: React.RefObject<(bt?: number | null, chargeTimeMs?: number) => void>;
}

export interface UseRoastLifecycleReturn {
    handleEnterStandby: () => void;
    handleManualCharge: () => Promise<void>;
    resetActiveRoast: (opts?: { chargeWait?: boolean; keepHeatHold?: boolean }) => void;
    confirmEndRoast: () => RoastSummaryData;
    completeDrop: (input: { livePoints: LiveRoastPoint[]; onset?: DropOnset }) => RoastSummaryData | null;
    /** Manual and auto Drop. Holds Charge through cool-down; disables Drop until Charge. */
    finishDrop: (input: {
        livePoints: LiveRoastPoint[];
        onset?: DropOnset;
        commitSummary: (summary: RoastSummaryData) => void;
        holdAutoChargeUntilRecovery: () => void;
    }) => RoastSummaryData | null;
    cancelDrop: () => boolean;
    recoverLiveBbp: () => void;
}

const isTauri = () => '__TAURI_INTERNALS__' in window;

export const useRoastLifecycle = (params: UseRoastLifecycleParams): UseRoastLifecycleReturn => {
    const {
        phase,
        sidecarConnected,
        rawBT,
        unit,
        logEntries,
        timeStr,
        enterStandby,
        enterPreheating,
        setConnected,
        resetStore,
        resetAutoDetectionRef,
        disableAutoChargeRef,
        disableAutoDropRef,
        rearmAutoChargeRef,
        setLogEntries,
        setLivePoints,
        setZoomRange,
        setHoveredChartIndex,
        triggerChargeRef,
    } = params;

    const roastSettings = useRoastSettings();
    const bbpEnabled = useFeature(FEATURE.bbp) && roastSettings.bbpEnabled;
    const canWrite = useWriteAccess();
    const quota = useBatchQuota();

    const warnReadOnly = useCallback(() => {
        if (!isTauri()) return;
        void message('현재 계정은 조회 전용입니다. 로스팅을 시작하려면 구독이 필요합니다.', {
            title: '로스팅 시작 불가',
            kind: 'warning',
        });
    }, []);

    /** 한도 소진은 저장 시점이 아니라 투입 전에 알려야 원두를 버리지 않는다. */
    const warnQuotaExceeded = useCallback(() => {
        if (!quota.exceeded || !isTauri()) return;
        void message(
            quota.isTrial
                ? `체험판 로스팅 한도(${quota.max}회)를 모두 사용했습니다. 계속하려면 구독이 필요합니다.`
                : `이번 달 로스팅 한도(${quota.max}회)에 도달했습니다. 계속하려면 상위 플랜이 필요합니다.`,
            { title: '로스팅 시작 불가', kind: 'warning' },
        );
    }, [quota.exceeded, quota.isTrial, quota.max]);

    const handleEnterStandby = useCallback(() => {
        if (phase !== 'preheating') return;
        // read_only도 quota.exceeded(max=0)에 걸리므로 canWrite를 먼저 봐야 맞는 메시지가 뜬다.
        if (!canWrite) {
            warnReadOnly();
            return;
        }
        // 자동 차지는 standby에서만 무장된다 — 여기서 막으면 수동/자동 양쪽이 함께 막힌다.
        if (quota.exceeded) {
            warnQuotaExceeded();
            return;
        }
        enterStandby();
        sidecar.enterStandby().catch(() => {});
    }, [phase, canWrite, warnReadOnly, enterStandby, quota.exceeded, warnQuotaExceeded]);

    const handleManualCharge = useCallback(async () => {
        if (isChargedPhase(useRoastingStore.getState().phase)) return;
        // UX guard only — 저장 경로는 서버 트리거가 최종 차단한다.
        if (!canWrite) {
            warnReadOnly();
            return;
        }
        if (quota.exceeded) {
            warnQuotaExceeded();
            return;
        }
        // await 전에 무장 해제 — getStatus 갭 동안 auto-charge 발화 창을 닫음 (#174)
        disableAutoChargeRef.current?.();
        const status = await sidecar.getStatus().catch(() => null);
        if (!status?.connected) {
            rearmAutoChargeRef.current?.();
            setConnected(false);
            if (isTauri()) {
                await message('머신이 연결되어 있지 않습니다.', { title: '머신 연결 필요', kind: 'warning' });
            }
            return;
        }
        // await 중 auto가 선착했으면 그대로 둔다 (triggerCharge 가드도 이중 차단)
        if (isChargedPhase(useRoastingStore.getState().phase)) return;
        // Bean/profile은 여기서 묻지 않는다 — 종료 시 RoastSummaryModal이 필수 검증과 함께 묻는다.
        triggerChargeRef.current?.(rawBT);
    }, [
        canWrite,
        warnReadOnly,
        quota.exceeded,
        warnQuotaExceeded,
        rawBT,
        triggerChargeRef,
        setConnected,
        disableAutoChargeRef,
        rearmAutoChargeRef,
    ]);

    const resetActiveRoast = useCallback(
        (opts?: { chargeWait?: boolean; keepHeatHold?: boolean }) => {
            resetAutoDetectionRef.current?.();
            const keepHeatHold = opts?.keepHeatHold ?? false;
            const chargeWait =
                opts?.chargeWait ?? (useBbpStore.getState().active || useRoastingStore.getState().awaitingNextCharge);
            resetStore();
            if (sidecarConnected) {
                sidecar.resetRoast().catch((error) => {
                    logger.capture(new Error('Roast reset command failed'), { reason: String(error) });
                });
                enterPreheating();
                // BBP: skip Roast Ready. Sidecar /standby is not called — virtual would
                // auto-drop beans in 10s and cut the wait short. Real BT drop still
                // auto-charges once phase is standby.
                if (waitPhaseAfterRoastReset(chargeWait) === 'standby') {
                    enterStandby();
                }
            }
            if (chargeWait || keepHeatHold) {
                useRoastingStore.setState({
                    awaitingNextCharge: chargeWait,
                    heatHoldAfterDrop: keepHeatHold,
                });
            }
            setLogEntries([]);
            setLivePoints([]);
            setZoomRange(null);
            setHoveredChartIndex(null);
        },
        [
            resetAutoDetectionRef,
            resetStore,
            sidecarConnected,
            enterPreheating,
            enterStandby,
            setLogEntries,
            setLivePoints,
            setZoomRange,
            setHoveredChartIndex,
        ],
    );

    const confirmEndRoast = useCallback((): RoastSummaryData => {
        const endTimeSec = useRoastingStore.getState().elapsed;
        const completedLogEntries: LogEntry[] = [
            ...logEntries,
            {
                id: crypto.randomUUID(),
                time: timeStr,
                timeSec: endTimeSec,
                event: 'End',
                temp: formatTemp(rawBT, unit),
                tempC: rawBT,
                note: 'Roast complete',
            },
        ];
        const metrics = deriveRoastMetrics(
            completedLogEntries.map((e) => ({ type: e.event, time_sec: logEntryTimeSec(e) })),
            { liveElapsed: endTimeSec },
        );
        const roastTimeStr = metrics.roastDurationSec != null ? formatElapsed(metrics.roastDurationSec) : timeStr;
        const development =
            metrics.devTimeSec != null && metrics.dtrPct != null && metrics.devTimeSec > 0
                ? `${formatElapsed(metrics.devTimeSec)} (${Number(metrics.dtrPct.toFixed(1))}%)`
                : '—';
        const summaryData: RoastSummaryData = {
            totalTime: roastTimeStr,
            development,
            finalBt: formatTemp(rawBT, unit),
            logEntries: completedLogEntries,
            sessionId: useRoastingStore.getState().sessionId,
            elapsedSec: endTimeSec,
        };
        // Abnormal abort: BBP starts at confirm time (no Drop). Machine still goes to Charge wait.
        if (bbpEnabled) useBbpStore.getState().begin(Date.now());
        useRoastingStore.setState({ awaitingNextCharge: true, heatHoldAfterDrop: true });
        return summaryData;
    }, [logEntries, timeStr, rawBT, unit, bbpEnabled]);

    const completeDrop = useCallback(
        (input: { livePoints: LiveRoastPoint[]; onset?: DropOnset }): RoastSummaryData | null => {
            const store = useRoastingStore.getState();
            const planned = planDropTransition({
                sessionId: store.sessionId,
                charged: isChargedPhase(store.phase),
                phase: store.phase,
                roastStartMs: store.roastStartMs,
                elapsed: store.elapsed,
                rawBT,
                unit,
                logEntries,
                livePoints: input.livePoints,
                onset: input.onset,
                droppedSessionId: useCompletedRoastStore.getState().droppedSessionId,
            });
            if (!planned) return null;
            useCompletedRoastStore.getState().capture({
                sessionId: planned.sessionId,
                roastStartMs: store.roastStartMs,
                elapsed: planned.dropTimeSec,
                logEntries: planned.logEntries,
                livePoints: planned.roastPoints as LiveRoastPoint[],
                sessionOwnerId: store.sessionOwnerId,
            });
            if (bbpEnabled) useBbpStore.getState().begin(planned.bbpStartMs, planned.bbpSeed);
            useRoastingStore.setState({ awaitingNextCharge: true, heatHoldAfterDrop: true });
            void replaceSessionTsv(planned.sessionId, formatTsvRows(planned.roastPoints, formatRoastTsvRow)).catch(
                (err) => {
                    logger.capture(err instanceof Error ? err : new Error(String(err)), {
                        context: 'drop clip session tsv',
                        sessionId: planned.sessionId,
                    });
                },
            );
            return {
                totalTime: planned.summary.totalTime,
                development: planned.summary.development,
                finalBt: planned.summary.finalBt,
                logEntries: planned.summary.logEntries,
                sessionId: planned.summary.sessionId,
                elapsedSec: planned.summary.elapsedSec,
            };
        },
        [logEntries, rawBT, unit, bbpEnabled],
    );

    const finishDrop = useCallback(
        (input: {
            livePoints: LiveRoastPoint[];
            onset?: DropOnset;
            commitSummary: (summary: RoastSummaryData) => void;
            holdAutoChargeUntilRecovery: () => void;
        }): RoastSummaryData | null => {
            // Stop the detector before the snapshot so a second onset in the same turn cannot enter.
            disableAutoDropRef.current();
            const summary = completeDrop({ livePoints: input.livePoints, onset: input.onset });
            if (!summary) return null;
            input.commitSummary(summary);
            resetActiveRoast({ chargeWait: true, keepHeatHold: true });
            // Drop cool-down must finish before the next auto Charge can fire.
            disableAutoDropRef.current();
            input.holdAutoChargeUntilRecovery();
            return summary;
        },
        [completeDrop, resetActiveRoast, disableAutoDropRef],
    );

    const cancelDrop = useCallback((): boolean => {
        if (!isDropCancelable()) return false;
        const restore = useCompletedRoastStore.getState().restore;
        if (!restore) return false;
        useBbpStore.getState().abort();
        void deleteBbpTsv(BBP_INPROGRESS_ID);
        clearPendingRoastSave(restore.sessionOwnerId ?? '', restore.sessionId);
        useCompletedRoastStore.getState().clear();
        const elapsed = Math.max(0, restore.elapsed);
        const origin = Date.now() - elapsed * 1000;
        useRoastingStore.setState({
            phase: 'roasting',
            sessionId: restore.sessionId,
            sessionOwnerId: restore.sessionOwnerId,
            roastStartMs: origin,
            elapsed,
            awaitingNextCharge: false,
            heatHoldAfterDrop: true,
        });
        setLogEntries(restore.logEntries.filter((e) => e.event !== 'Drop'));
        setLivePoints(restore.livePoints);
        return true;
    }, [setLogEntries, setLivePoints]);

    const recoverLiveBbp = useCallback(() => {
        if (!bbpEnabled) return;
        const store = useRoastingStore.getState();
        // A roast already owns the chart. Do not rehydrate a wait on top of it (#433).
        if (isChargedPhase(store.phase)) return;
        if (!hydrateLiveBbp()) return;
        useRoastingStore.setState({ awaitingNextCharge: true });
        if (store.sidecarConnected && (store.phase === 'idle' || store.phase === 'preheating')) {
            store.enterPreheating();
            store.enterStandby();
        }
    }, [bbpEnabled]);

    return {
        handleEnterStandby,
        handleManualCharge,
        resetActiveRoast,
        confirmEndRoast,
        completeDrop,
        finishDrop,
        cancelDrop,
        recoverLiveBbp,
    };
};
