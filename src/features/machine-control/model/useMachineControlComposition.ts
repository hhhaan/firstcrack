import type { PidRuntime } from '@entities/machine';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ControlCommand, ControlOrigin, ControlRole } from '../lib/controlSender';
import { createGasOffDiagnostics, type GasOffDiagnosticContext } from '../lib/gasOffDiagnostics';
import { numericHeaterStep } from '../lib/heater-events';
import type { ReplayPoint } from '../lib/replay';
import { type MachineFeedback, useMachineControl } from './useMachineControl';
import { usePidControl } from './usePidControl';
import { type ObservationQuality, type ReplayStopReason, useReplayControl } from './useReplayControl';

export interface MachineControlCompositionInput {
    sidecarConnected: boolean;
    /** 사이드카 재연결 대기 — 실측 동결 중이라 이탈 카운트를 멈춘다 (#307) */
    reconnecting: boolean;
    liveData: MachineFeedback;
    pidRuntime: PidRuntime | null;
    /** 배출·로스팅 종료 — PID 자동 해제 신호 */
    roastFinished: boolean;
    pidDropBehavior: 'hold' | 'zero';
    /** 타겟 프로파일 커브 — Replay Assist 레퍼런스 (#300). 없으면 Replay 숨김 */
    replayPoints: ReplayPoint[] | null;
    /** 레퍼런스가 다른 기종 기록 — Replay 차단 (같은 기기만 재생) */
    replayMachineMismatch: boolean;
    /** 레퍼런스의 charge→drop 초 — 배출 후 기록 제외용 */
    replayDropTime: number | null;
    referenceTpTime?: number | null;
    /** 프로파일 heater_events jsonb (#435) */
    replayHeaterEvents?: unknown;
    /** Raw sensor BT. `observationQuality` must validate this stream, not the display EMA. */
    liveBt: number | null;
    elapsed: number;
    roasting: boolean;
    /** Settings: start Replay when Charge begins. Off leaves the panel checkbox as the only start. */
    replayOnCharge?: boolean;
    /** 실기 TP 사실 — 게이트·대기 UI는 Replay 모듈이 파생 (#314, R08) */
    confirmedTurningPoint: { fallback?: boolean } | null;
    /** R04 제어용 관측 품질. null = 현재 generation 관측 없음 */
    observationQuality: ObservationQuality | null;
    /** Last-valid observation wall-clock for long-gap stop. null = this generation unknown */
    lastValidReceivedAtMs?: number | null;
    nowMs?: number | null;
    /** 사용자·Replay가 화력 전송을 확정한 순간의 값 */
    onHeaterCommitted?: (value: number, unit: string) => void;
    /** Raw applied command. Tests use this; the heater log uses onHeaterCommitted. */
    onCommitted?: (committed: ControlCommand) => void;
    onApplied?: (applied: ControlCommand) => void;
    diagnostics?: Pick<GasOffDiagnosticContext, 'sessionId' | 'receivedAtMs' | 'sample'>;
}

/**
 * Manual setpoint, PID, and Replay share one lifetime.
 * Display (collapse, entitlement, empty panel) must not mount or unmount this hook.
 * Replay stop cancels unsent Replay heater writes and does not restart.
 */
export const useMachineControlComposition = ({
    sidecarConnected,
    reconnecting,
    liveData,
    pidRuntime,
    roastFinished,
    pidDropBehavior,
    replayPoints,
    replayMachineMismatch,
    replayDropTime,
    referenceTpTime,
    replayHeaterEvents,
    liveBt,
    elapsed,
    roasting,
    replayOnCharge,
    confirmedTurningPoint,
    observationQuality,
    lastValidReceivedAtMs,
    nowMs,
    onHeaterCommitted,
    onCommitted,
    onApplied,
    diagnostics,
}: MachineControlCompositionInput) => {
    const gasOffDiagnostics = useMemo(() => createGasOffDiagnostics(), []);
    const heaterUnitRef = useRef('%');
    const handleCommitted = useCallback(
        (committed: ControlCommand) => {
            onCommitted?.(committed);
            if (committed.heater !== undefined) onHeaterCommitted?.(committed.heater, heaterUnitRef.current);
        },
        [onCommitted, onHeaterCommitted],
    );
    const machine = useMachineControl(sidecarConnected, liveData, handleCommitted, onApplied, gasOffDiagnostics);
    useEffect(() => {
        gasOffDiagnostics.updateContext({
            sessionId: diagnostics?.sessionId ?? null,
            receivedAtMs: diagnostics?.receivedAtMs ?? null,
            sample: diagnostics?.sample ?? null,
            roaster: machine.connectionStatus?.roaster ?? null,
            connectionEpoch: machine.connectionStatus?.connection_epoch ?? null,
            connected: sidecarConnected,
            reconnecting,
            heaterReadable: (machine.connectionStatus?.capabilities ?? []).includes('heater'),
            elapsed,
            bt: liveBt,
        });
    }, [gasOffDiagnostics, diagnostics, machine.connectionStatus, sidecarConnected, reconnecting, elapsed, liveBt]);
    useEffect(() => () => gasOffDiagnostics.reset(), [gasOffDiagnostics]);
    useEffect(() => {
        heaterUnitRef.current = machine.limits.heater?.unit ?? '%';
    }, [machine.limits.heater?.unit]);

    // PID lifetime includes DROP safe-off. It stays mounted when the panel is hidden (#269).
    const pid = usePidControl({
        sidecarConnected,
        capability: machine.pidCapability,
        runtime: pidRuntime,
        roastFinished,
        dropBehavior: pidDropBehavior,
    });
    const pidActive = (pidRuntime?.state ?? 'off') !== 'off';

    // Replay writes only through setValue + commitNow. A drag preview is not a send.
    const writeHeater = useCallback(
        async (value: number, origin: ControlOrigin = 'replay') => {
            machine.setValue('heater', value);
            const applied = await machine.commitNow(origin);
            return applied?.heater ?? null;
        },
        [machine.setValue, machine.commitNow],
    );
    const commitManual = useCallback(() => {
        void machine.commitNow('manual');
    }, [machine.commitNow]);
    const retryEpoch = machine.connectionStatus?.connection_epoch;
    const retryHeater = useCallback(
        async (value: number) => {
            if (retryEpoch == null) return null;
            machine.setValue('heater', value);
            return (await machine.commitNow('replay', { connectionEpoch: retryEpoch }))?.heater ?? null;
        },
        [retryEpoch, machine.setValue, machine.commitNow],
    );
    const replay = useReplayControl({
        sessionId: diagnostics?.sessionId ?? null,
        referencePoints: replayPoints,
        referenceMachineMismatch: replayMachineMismatch,
        referenceDropTime: replayDropTime,
        referenceTpTime,
        profileHeaterEvents: replayHeaterEvents,
        liveBt,
        elapsed,
        roasting,
        armOnCharge: replayOnCharge,
        confirmedTurningPoint,
        heaterWritable: machine.writable && machine.limits.heater != null,
        // fault included — heater ownership stays with PID until it is off
        pidEngaged: pidActive,
        roastFinished,
        sidecarConnected,
        safeOffUnacknowledged: machine.safeOffUnacknowledged,
        dropBehavior: pidDropBehavior,
        reconnecting,
        observationQuality,
        lastValidReceivedAtMs,
        nowMs,
        writeHeater,
        retryHeater: retryEpoch == null ? undefined : retryHeater,
        connectionEpoch: retryEpoch,
        cancelUnsentHeater: machine.cancelUnsentReplayHeater,
        heaterMax: machine.limits.heater?.max,
        heaterMin: machine.limits.heater?.min,
        heaterStep: numericHeaterStep((machine.limits.heater as { step?: unknown } | undefined)?.step),
    });

    // Manual heater edits stop Replay. Replay's own setValue must not stop itself.
    const changeManual = useCallback(
        (role: ControlRole, value: number) => {
            if (role === 'heater') replay.stop();
            machine.setValue(role, value);
        },
        [replay.stop, machine.setValue],
    );

    return { machine, pid, replay, pidActive, changeManual, commitManual };
};

export type MachineControlComposition = ReturnType<typeof useMachineControlComposition>;
export type { ReplayStopReason };
