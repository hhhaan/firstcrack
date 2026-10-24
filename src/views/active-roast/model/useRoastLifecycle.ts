import type { RawTemperatureSample } from '@features/active-roast/lib/autoCharge';
import type { DropOnset } from '@features/active-roast/lib/drop-transition';
import type { RoastSummaryData } from '@features/active-roast/model/batch';
import { BBP_INPROGRESS_ID, hydrateLiveBbp, useBbpStore } from '@features/active-roast/model/bbp';
import { clearPendingRoastSave } from '@features/active-roast/model/pendingRoastSave';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { useRoastSettings } from '@features/active-roast/model/settings';
import { isChargedPhase, useRoastingStore } from '@features/active-roast/model/status';
import { useBatchQuota } from '@features/active-roast/model/useBatchQuota';
import { FEATURE, useFeature, useWriteAccess } from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { deleteBbpTsv, formatRoastTsvRow, formatTsvRows, replaceSessionTsv } from '@shared/lib/tsv-writer';
import { message } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import type { LiveRoastPoint } from './useSidecarPolling';

export interface UseRoastLifecycleParams {
    phase: string;
    sidecarConnected: boolean;
    rawBT: number | null;
    unit: TemperatureUnit;
    enterStandby: () => void;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    resetAutoDetectionRef: React.RefObject<() => void>;
    disableAutoChargeRef: React.RefObject<() => void>;
    disableAutoDropRef: React.RefObject<() => void>;
    rearmAutoChargeRef: React.RefObject<() => void>;
    setZoomRange: (range: { start: number; end: number } | null) => void;
    setHoveredChartIndex: (index: number | null) => void;
    triggerChargeRef: React.RefObject<(bt?: number | null, origin?: number | RawTemperatureSample) => void>;
    replayActiveRef?: React.RefObject<boolean>;
    onFsdDropRef?: React.RefObject<() => void>;
}

export interface UseRoastLifecycleReturn {
    handleEnterStandby: () => void;
    handleManualCharge: () => Promise<boolean>;
    resetActiveRoast: (opts?: { chargeWait?: boolean; keepHeatHold?: boolean }) => void;
    confirmEndRoast: (commitSummary?: (summary: RoastSummaryData) => void) => RoastSummaryData;
    completeDrop: (input: { livePoints: LiveRoastPoint[]; onset?: DropOnset }) => RoastSummaryData | null;
    /** Manual and auto Drop. Holds Charge through cool-down; disables Drop until Charge. */
    finishDrop: (input: {
        livePoints: LiveRoastPoint[];
        onset?: DropOnset;
        commitSummary: (summary: RoastSummaryData) => void;
        holdAutoChargeUntilRecovery: () => void;
    }) => RoastSummaryData | null;
    cancelDrop: (expectedSessionId?: string | null) => boolean;
    recoverLiveBbp: () => void;
}

const isTauri = () => '__TAURI_INTERNALS__' in window;

export const useRoastLifecycle = (params: UseRoastLifecycleParams): UseRoastLifecycleReturn => {
    const {
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
        setZoomRange,
        setHoveredChartIndex,
        triggerChargeRef,
        replayActiveRef,
        onFsdDropRef,
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
        if (isChargedPhase(useRoastingStore.getState().phase)) return false;
        // UX guard only — 저장 경로는 서버 트리거가 최종 차단한다.
        if (!canWrite) {
            warnReadOnly();
            return false;
        }
        if (quota.exceeded) {
            warnQuotaExceeded();
            return false;
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
            return false;
        }
        // await 중 auto가 선착했으면 그대로 둔다 (triggerCharge 가드도 이중 차단)
        if (isChargedPhase(useRoastingStore.getState().phase)) return false;
        // Bean/profile은 여기서 묻지 않는다 — 종료 시 RoastSummaryModal이 필수 검증과 함께 묻는다.
        triggerChargeRef.current?.(rawBT);
        return isChargedPhase(useRoastingStore.getState().phase);
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

    const resetEffects = useCallback(() => {
        resetAutoDetectionRef.current?.();
        if (sidecarConnected) {
            sidecar.resetRoast().catch((error) => {
                logger.capture(new Error('Roast reset command failed'), { reason: String(error) });
            });
        }
        setZoomRange(null);
        setHoveredChartIndex(null);
    }, [resetAutoDetectionRef, sidecarConnected, setZoomRange, setHoveredChartIndex]);
    const resetActiveRoast = useCallback(
        (opts?: { chargeWait?: boolean; keepHeatHold?: boolean }) => {
            const state = useRoastingStore.getState();
            state.resetCurrentBatch({
                ...opts,
                chargeWait: opts?.chargeWait ?? (useBbpStore.getState().active || state.awaitingNextCharge),
            });
            resetEffects();
        },
        [resetEffects],
    );
    const confirmEndRoast = useCallback(
        (commitSummary?: (summary: RoastSummaryData) => void): RoastSummaryData => {
            const summary = useRoastingStore.getState().abortRoast(rawBT, unit);
            onFsdDropRef?.current();
            commitSummary?.(summary);
            if (bbpEnabled) useBbpStore.getState().begin(Date.now());
            if (commitSummary) resetEffects();
            return summary;
        },
        [rawBT, unit, bbpEnabled, resetEffects, onFsdDropRef],
    );
    const completeDrop = useCallback(
        (input: {
            livePoints: LiveRoastPoint[];
            onset?: DropOnset;
            commitSummary?: (summary: RoastSummaryData) => void;
        }): RoastSummaryData | null => {
            const planned = useRoastingStore
                .getState()
                .drop({ ...input, rawBT, unit, replayActive: replayActiveRef?.current ?? false });
            if (!planned) return null;
            onFsdDropRef?.current();
            input.commitSummary?.(planned.summary);
            if (bbpEnabled) useBbpStore.getState().begin(planned.bbpStartMs, planned.bbpSeed);
            void replaceSessionTsv(
                planned.sessionId,
                formatTsvRows(planned.snapshot.livePoints, formatRoastTsvRow),
            ).catch((err) => {
                logger.capture(err instanceof Error ? err : new Error(String(err)), {
                    context: 'drop clip session tsv',
                    sessionId: planned.sessionId,
                });
            });
            return planned.summary;
        },
        [rawBT, unit, bbpEnabled, replayActiveRef, onFsdDropRef],
    );
    const finishDrop = useCallback(
        (input: {
            livePoints: LiveRoastPoint[];
            onset?: DropOnset;
            commitSummary: (summary: RoastSummaryData) => void;
            holdAutoChargeUntilRecovery: () => void;
        }): RoastSummaryData | null => {
            disableAutoDropRef.current();
            const summary = completeDrop(input);
            if (!summary) return null;
            resetEffects();
            disableAutoDropRef.current();
            input.holdAutoChargeUntilRecovery();
            return summary;
        },
        [completeDrop, resetEffects, disableAutoDropRef],
    );
    const cancelDrop = useCallback((expectedSessionId?: string | null): boolean => {
        const restore = useRoastingStore.getState().cancelDrop(expectedSessionId);
        if (!restore) return false;
        useBbpStore.getState().abort();
        void deleteBbpTsv(BBP_INPROGRESS_ID);
        try {
            clearPendingRoastSave(restore.sessionOwnerId ?? '', restore.sessionId);
        } catch (err) {
            logger.capture(err, { context: 'cancelDrop.pendingCheckpoint', sessionId: restore.sessionId });
        }
        return true;
    }, []);

    const recoverLiveBbp = useCallback(() => {
        if (!bbpEnabled) return;
        const store = useRoastingStore.getState();
        // A roast already owns the chart. Do not rehydrate a wait on top of it (#433).
        if (isChargedPhase(store.phase)) return;
        if (!hydrateLiveBbp()) return;
        store.recoverChargeWait();
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
