import { formatTemp } from '@features/active-roast/lib/temperature';
import { useBbpStore } from '@features/active-roast/model/bbp';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useBatchQuota } from '@features/active-roast/model/useBatchQuota';
import { FEATURE, useFeature, useWriteAccess } from '@shared/lib/features';
import { sidecar } from '@shared/lib/sidecar';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import type { LogEntry } from '@shared/types/roast';
import { message } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import type { RoastSummaryData } from './useRoastCompletionFlow';
import type { LiveRoastPoint } from './useSidecarPolling';

export interface UseRoastLifecycleParams {
    phase: string;
    charged: boolean;
    sidecarConnected: boolean;
    rawBT: number | null;
    /**
     * Bean is required before charge — saving and stock deduction both key off it.
     * A scheduled batch is exempt: a blend-only batch legitimately hands off with
     * `beanId === null` and deducts through the blend path instead.
     */
    selectedBeanId: string | null;
    planBatchHandoff: PlanBatchHandoff | null;
    /** No registered beans → nothing to select, so the gate must not lock a first-run user out. */
    hasSelectableBeans: boolean;
    onBeanSelectionRequired: () => void;
    unit: TemperatureUnit;
    logEntries: LogEntry[];
    timeStr: string;
    devTimeStr: string;
    enterStandby: () => void;
    enterPreheating: (capabilities?: string[]) => void;
    storeEndRoast: () => void;
    setConnected: (connected: boolean, capabilities?: string[]) => void;
    setIsRunning: (running: boolean) => void;
    resetStore: () => void;
    resetAutoDetectionRef: React.RefObject<() => void>;
    disableAutoChargeRef: React.RefObject<() => void>;
    setLogEntries: (entries: LogEntry[]) => void;
    setLivePoints: (points: LiveRoastPoint[]) => void;
    setZoomRange: (range: { start: number; end: number } | null) => void;
    setHoveredChartIndex: (index: number | null) => void;
    triggerChargeRef: React.RefObject<(bt?: number | null, chargeTimeMs?: number) => void>;
    roastStartTimeRef: React.MutableRefObject<number>;
}

export interface UseRoastLifecycleReturn {
    handleEnterStandby: () => void;
    handleManualCharge: () => Promise<void>;
    resetActiveRoast: () => void;
    confirmEndRoast: () => RoastSummaryData;
}

const isTauri = () => '__TAURI_INTERNALS__' in window;

export const useRoastLifecycle = (params: UseRoastLifecycleParams): UseRoastLifecycleReturn => {
    const {
        phase,
        charged,
        sidecarConnected,
        rawBT,
        selectedBeanId,
        planBatchHandoff,
        hasSelectableBeans,
        onBeanSelectionRequired,
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
        setZoomRange,
        setHoveredChartIndex,
        triggerChargeRef,
        roastStartTimeRef,
    } = params;

    const bbpEnabled = useFeature(FEATURE.bbp);
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
        if (charged) return;
        // UX guard only — 저장 경로는 서버 트리거가 최종 차단한다.
        if (!canWrite) {
            warnReadOnly();
            return;
        }
        if (quota.exceeded) {
            warnQuotaExceeded();
            return;
        }
        const status = await sidecar.getStatus().catch(() => null);
        if (!status?.connected) {
            setConnected(false);
            if (isTauri()) {
                await message('머신이 연결되어 있지 않습니다.', { title: '머신 연결 필요', kind: 'warning' });
            }
            return;
        }
        // Asked last so the selection modal only appears when charge would otherwise start.
        if (!selectedBeanId && !planBatchHandoff && hasSelectableBeans) {
            onBeanSelectionRequired();
            return;
        }
        disableAutoChargeRef.current?.();
        triggerChargeRef.current?.(rawBT);
    }, [
        charged,
        canWrite,
        warnReadOnly,
        quota.exceeded,
        warnQuotaExceeded,
        rawBT,
        selectedBeanId,
        planBatchHandoff,
        hasSelectableBeans,
        onBeanSelectionRequired,
        triggerChargeRef,
        setConnected,
        disableAutoChargeRef,
    ]);

    const resetActiveRoast = useCallback(() => {
        roastStartTimeRef.current = 0;
        resetAutoDetectionRef.current?.();
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
    }, [
        roastStartTimeRef,
        resetAutoDetectionRef,
        setIsRunning,
        resetStore,
        sidecarConnected,
        enterPreheating,
        setLogEntries,
        setLivePoints,
        setZoomRange,
        setHoveredChartIndex,
    ]);

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
        const summaryData: RoastSummaryData = {
            totalTime: timeStr,
            development: devTimeStr,
            finalBt: formatTemp(rawBT, unit),
            logEntries: completedLogEntries,
        };
        storeEndRoast();
        // BBP: 드롭 시점부터 다음 charge까지 배치간 기록 시작 (Pro 전용 — 유일한 게이팅 지점).
        // ponytail: 기준점은 Drop 로그 시각이 아니라 종료 확정 시각 — 그 사이 phase가 'roasting'이라
        // 어차피 커브가 안 쌓인다. 확정을 늦게 누르면 bbp_seconds가 그만큼 짧게 잡힌다.
        if (bbpEnabled) useBbpStore.getState().begin(Date.now());
        setIsRunning(false);
        return summaryData;
    }, [logEntries, timeStr, devTimeStr, rawBT, unit, storeEndRoast, setIsRunning, bbpEnabled]);

    return {
        handleEnterStandby,
        handleManualCharge,
        resetActiveRoast,
        confirmEndRoast,
    };
};
