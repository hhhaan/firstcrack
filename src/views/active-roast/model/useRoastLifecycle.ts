import { formatTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { sidecar } from '@shared/lib/sidecar';
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

    const handleEnterStandby = useCallback(() => {
        if (phase !== 'preheating') return;
        enterStandby();
        sidecar.enterStandby().catch(() => {});
    }, [phase, enterStandby]);

    const handleManualCharge = useCallback(async () => {
        if (charged) return;
        const status = await sidecar.getStatus().catch(() => null);
        if (!status?.connected) {
            setConnected(false);
            if (isTauri()) {
                await message('머신이 연결되어 있지 않습니다.', { title: '머신 연결 필요', kind: 'warning' });
            }
            return;
        }
        disableAutoChargeRef.current?.();
        triggerChargeRef.current?.(rawBT);
    }, [charged, rawBT, triggerChargeRef, setConnected, disableAutoChargeRef]);

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
        const completedLogEntries = [
            ...logEntries,
            { time: timeStr, event: 'End', temp: formatTemp(rawBT, unit), note: 'Roast complete' },
        ];
        const summaryData: RoastSummaryData = {
            totalTime: timeStr,
            development: devTimeStr,
            finalBt: formatTemp(rawBT, unit),
            logEntries: completedLogEntries,
        };
        storeEndRoast();
        setIsRunning(false);
        return summaryData;
    }, [logEntries, timeStr, devTimeStr, rawBT, unit, storeEndRoast, setIsRunning]);

    return {
        handleEnterStandby,
        handleManualCharge,
        resetActiveRoast,
        confirmEndRoast,
    };
};
