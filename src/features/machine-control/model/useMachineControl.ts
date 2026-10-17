import type { ControlCapability, SidecarStatus } from '@entities/machine';
import { logger } from '@shared/lib/logger';
import { sidecar, subscribeSidecarSettings } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { convergeTolerance } from '../lib/controlScale';
import {
    type ControlCommand,
    type ControlOrigin,
    type ControlRole,
    createControlSender,
    settledRoles,
} from '../lib/controlSender';
import { devRoasterControl } from '../lib/devRoasterPreview';

export type { ControlOrigin, ControlRole } from '../lib/controlSender';

const EMPTY_LIMITS: ControlCapability['limits'] = {};

const ROLES: ControlRole[] = ['heater', 'fan', 'drum'];

/** Drop-zero retries only; feedback lag never fails an ordinary command. */
const SAFE_OFF_RETRY_POLLS = 10;

/** /status 실패 시 capability 재조회 간격 */
const CAPABILITY_RETRY_MS = 3000;

/** null means the machine cannot report that feedback channel. */
export type MachineFeedback = Record<ControlRole, number | null> | null;

/**
 * 머신 수동 제어(setpoint 쓰기) 상태.
 *
 * 쓰기 가능 여부와 범위는 사이드카 `/status.control`에서 받는다. 레지스트리 TS
 * 미러에는 주소 맵이 없고(파이썬 전용), 범위도 머신마다 다르므로 런타임 값이 유일한 출처다.
 *
 * **지시값은 기기가 따라오면 버린다.** 그래야 슬라이더가 기기를 따라간다 —
 * 로스터 본체 조작반에서 화력을 돌렸을 때도 화면이 같이 움직여야 하고,
 * PID가 화력을 잡고 있을 때도 실제 duty가 보여야 한다.
 */
export const useMachineControl = (
    sidecarConnected: boolean,
    feedback: MachineFeedback,
    onCommitted?: (committed: ControlCommand) => void,
    onApplied?: (applied: ControlCommand) => void,
) => {
    const [connectionStatus, setConnectionStatus] = useState<SidecarStatus | null>(null);
    const capability = connectionStatus?.control;
    const [tracking, setTracking] = useState<{
        desired: ControlCommand;
        zeroPolls: number;
        /** Remember the zero request even when the adapter clamps the applied value. */
        zeroRequested: boolean;
    }>({ desired: {}, zeroPolls: 0, zeroRequested: false });
    const [sending, setSending] = useState(false);

    const sender = useMemo(
        () =>
            createControlSender({
                send: async (cmd) => (await sidecar.setControl(cmd)).applied,
                onApplied: (applied) => setTracking((t) => ({ ...t, desired: { ...t.desired, ...applied } })),
                onError: (err) => {
                    logger.capture(err, { feature: 'machine-control', action: 'setControl' });
                    useToastStore
                        .getState()
                        .show(err instanceof Error ? err.message : '제어 명령을 보내지 못했습니다.', 'error');
                },
                onSendingChange: setSending,
            }),
        [],
    );

    useEffect(() => sender.setOnCommitted(onCommitted), [onCommitted, sender]);
    const handleApplied = useCallback(
        (applied: ControlCommand) => {
            setTracking((t) => ({ ...t, desired: { ...t.desired, ...applied } }));
            onApplied?.(applied);
        },
        [onApplied],
    );
    useEffect(() => sender.setOnApplied(handleApplied), [handleApplied, sender]);

    useEffect(() => () => sender.dispose(), [sender]);

    // 연결될 때 제어 능력을 확인한다. 끊기면 즉시 비활성화하고 대기 중인 명령을 버린다.
    useEffect(() => {
        if (!sidecarConnected) {
            sender.dispose();
            setConnectionStatus(null);
            setTracking({ desired: {}, zeroPolls: 0, zeroRequested: false });
            return;
        }
        let cancelled = false;
        let requestSequence = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const fetchCapability = () => {
            const request = ++requestSequence;
            if (timer) clearTimeout(timer);
            sidecar
                .getStatus()
                .then((s) => {
                    if (!cancelled && request === requestSequence) {
                        setConnectionStatus(s);
                        timer = setTimeout(fetchCapability, 1000);
                    }
                })
                .catch(() => {
                    // 일시 실패로 capability를 null로 덮으면 패널이 통째로 사라지고
                    // PID 안전 훅까지 언마운트됐었다(#269). 기존 값을 유지한 채
                    // 재시도한다 — 연결 자체가 끊기면 위 분기가 정리한다.
                    if (!cancelled && request === requestSequence) {
                        setConnectionStatus((previous) =>
                            previous
                                ? {
                                      ...previous,
                                      control: {
                                          ...previous.control,
                                          writable: previous.control?.writable ?? false,
                                          limits: previous.control?.limits ?? EMPTY_LIMITS,
                                      },
                                  }
                                : null,
                        );
                        timer = setTimeout(fetchCapability, CAPABILITY_RETRY_MS);
                    }
                });
        };
        const unsubscribe = subscribeSidecarSettings(fetchCapability);
        fetchCapability();
        return () => {
            unsubscribe();
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [sidecarConnected, sender]);

    // 기기가 지시값을 따라오면 그 지시를 버린다 → 이후 슬라이더는 기기 실측을 따라간다.
    // 이걸 안 하면 한 번 만진 슬라이더가 영원히 내 값에 고정돼, 본체 조작반에서
    // 화력을 바꿔도 화면이 그대로다.
    const heaterMax = capability?.limits.heater?.max;
    useEffect(() => {
        if (!feedback) return;
        setTracking((tracking) => {
            const { desired: prev, zeroPolls: prevZeroPolls } = tracking;
            const settled = settledRoles(prev, feedback, convergeTolerance(heaterMax));
            const zeroPolls =
                tracking.zeroRequested && prev.heater != null && !settled.includes('heater')
                    ? Math.min(prevZeroPolls + 1, SAFE_OFF_RETRY_POLLS)
                    : 0;
            if (settled.length === 0 && zeroPolls === prevZeroPolls) return tracking;
            const nextDesired = { ...prev };
            for (const role of settled) delete nextDesired[role];
            return { ...tracking, desired: nextDesired, zeroPolls };
        });
    }, [feedback, heaterMax]);

    const setValue = useCallback(
        (role: ControlRole, value: number) => {
            // A new heater write restarts the separate Drop-zero retry window.
            setTracking((t) => ({
                desired: { ...t.desired, [role]: value },
                zeroPolls: role === 'heater' ? 0 : t.zeroPolls,
                zeroRequested: role === 'heater' ? value === 0 : t.zeroRequested,
            }));
            sender.queue(role, value);
        },
        [sender],
    );

    /** 전송 성공 여부 — 슬라이더는 무시하고, Replay는 실패 시 이벤트를 보존한다 (#312) */
    const commitNow = useCallback((origin?: ControlOrigin) => sender.commitNow(origin), [sender]);
    /** 미전송 Replay heater만 — fan/drum·수동·DROP zero는 남긴다 (#368 R03) */
    const cancelUnsentReplayHeater = useCallback(() => {
        const cancelled = sender.cancelUnsent({ origin: 'replay', role: 'heater' });
        if (cancelled.length === 0) return;
        setTracking((t) => {
            const nextDesired = { ...t.desired };
            let changed = false;
            for (const cmd of cancelled) {
                for (const role of ROLES) {
                    if (cmd[role] == null || nextDesired[role] !== cmd[role]) continue;
                    delete nextDesired[role];
                    changed = true;
                }
            }
            return changed
                ? { ...t, desired: nextDesired, zeroPolls: nextDesired.heater != null ? t.zeroPolls : 0 }
                : t;
        });
    }, [sender]);

    // 연결이 없으면 env로 고른 기기의 제어 화면만 채운다. 쓰기는 사이드카가 그대로 거절한다.
    const preview = sidecarConnected ? null : devRoasterControl();
    return {
        writable: (Boolean(capability?.writable) && sidecarConnected) || Boolean(preview?.writable),
        connectionStatus: sidecarConnected ? connectionStatus : null,
        limits: sidecarConnected ? (capability?.limits ?? EMPTY_LIMITS) : (preview?.limits ?? EMPTY_LIMITS),
        /** PID 지원 여부 — 같은 /status 응답에서 오므로 따로 조회하지 않는다 */
        pidCapability: sidecarConnected ? capability?.pid : preview?.pid,
        desired: tracking.desired,
        safeOffUnacknowledged: tracking.zeroPolls >= SAFE_OFF_RETRY_POLLS,
        sending,
        setValue,
        commitNow,
        cancelUnsentReplayHeater,
    };
};
