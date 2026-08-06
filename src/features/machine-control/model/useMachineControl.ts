import type { ControlCapability } from '@entities/machine';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type ControlCommand, type ControlRole, createControlSender } from '../lib/controlSender';

export type { ControlRole } from '../lib/controlSender';

const EMPTY_LIMITS: ControlCapability['limits'] = {};

/**
 * 머신 수동 제어(setpoint 쓰기) 상태.
 *
 * 쓰기 가능 여부와 범위는 사이드카 `/status.control`에서 받는다. 레지스트리 TS
 * 미러에는 주소 맵이 없고(파이썬 전용), 범위도 머신마다 다르므로 런타임 값이 유일한 출처다.
 */
export const useMachineControl = (sidecarConnected: boolean) => {
    const [capability, setCapability] = useState<ControlCapability | null>(null);
    /** 사용자가 지시한 값 — 전송 왕복과 무관하게 슬라이더가 즉시 따라가는 값 */
    const [desired, setDesired] = useState<ControlCommand>({});
    const [sending, setSending] = useState(false);

    const sender = useMemo(
        () =>
            createControlSender({
                send: async (cmd) => (await sidecar.setControl(cmd)).applied,
                onApplied: (applied) => setDesired((prev) => ({ ...prev, ...applied })),
                onError: (err) => {
                    logger.error('[machine-control] 제어 전송 실패:', err);
                    useToastStore
                        .getState()
                        .show(err instanceof Error ? err.message : '제어 명령을 보내지 못했습니다.', 'error');
                },
                onSendingChange: setSending,
            }),
        [],
    );

    useEffect(() => () => sender.dispose(), [sender]);

    // 연결될 때 제어 능력을 확인한다. 끊기면 즉시 비활성화하고 대기 중인 명령을 버린다.
    useEffect(() => {
        if (!sidecarConnected) {
            sender.dispose();
            setCapability(null);
            setDesired({});
            return;
        }
        let cancelled = false;
        sidecar
            .getStatus()
            .then((s) => {
                if (!cancelled) setCapability(s.control ?? { writable: false, limits: EMPTY_LIMITS });
            })
            .catch(() => {
                if (!cancelled) setCapability(null);
            });
        return () => {
            cancelled = true;
        };
    }, [sidecarConnected, sender]);

    const setValue = useCallback(
        (role: ControlRole, value: number) => {
            setDesired((prev) => ({ ...prev, [role]: value }));
            sender.queue(role, value);
        },
        [sender],
    );

    const commitNow = useCallback(() => void sender.commitNow(), [sender]);

    return {
        writable: Boolean(capability?.writable) && sidecarConnected,
        limits: capability?.limits ?? EMPTY_LIMITS,
        desired,
        sending,
        setValue,
        commitNow,
    };
};
