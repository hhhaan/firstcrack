import type { ControlCapability } from '@entities/machine';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type ControlCommand, type ControlRole, createControlSender, settledRoles } from '../lib/controlSender';

export type { ControlRole } from '../lib/controlSender';

const EMPTY_LIMITS: ControlCapability['limits'] = {};

const ROLES: ControlRole[] = ['heater', 'fan', 'drum'];

/** 기기 실측이 지시값에 이만큼 근접하면 "따라왔다"고 본다 (채널 단위) */
const CONVERGE_TOLERANCE = 1;
/**
 * 이만큼의 폴링 동안 기기가 안 따라오면 명령이 먹지 않은 것으로 보고 경고한다.
 * 경과 시간 대신 폴링 횟수로 세는 이유: 시계를 읽지 않아도 되고(렌더 순수성),
 * 판정 기준이 "기기를 N번 확인했는데 그대로였다"로 더 직접적이다.
 * 폴링 주기 0.5~1s 기준 약 5~10초.
 */
const STALE_COMMAND_POLLS = 10;

/** /status 실패 시 capability 재조회 간격 */
const CAPABILITY_RETRY_MS = 3000;

export type MachineFeedback = Record<ControlRole, number> | null;

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
export const useMachineControl = (sidecarConnected: boolean, feedback: MachineFeedback) => {
    const [capability, setCapability] = useState<ControlCapability | null>(null);
    /**
     * desired: 사용자가 지시했지만 기기가 아직 따라오지 않은 값
     * unackPolls: role별로 "지시했는데 기기가 그대로였던" 폴링 횟수
     * 한 state로 묶은 이유: feedback 반영 시 둘을 원자적으로 갱신해야 하는데,
     * updater 안에서 다른 setState를 부르면 순수성이 깨진다(StrictMode 재실행 시 이중 카운트).
     */
    const [tracking, setTracking] = useState<{
        desired: ControlCommand;
        unackPolls: Partial<Record<ControlRole, number>>;
    }>({ desired: {}, unackPolls: {} });
    const [sending, setSending] = useState(false);

    const sender = useMemo(
        () =>
            createControlSender({
                send: async (cmd) => (await sidecar.setControl(cmd)).applied,
                onApplied: (applied) => setTracking((t) => ({ ...t, desired: { ...t.desired, ...applied } })),
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
            setTracking({ desired: {}, unackPolls: {} });
            return;
        }
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const fetchCapability = () => {
            sidecar
                .getStatus()
                .then((s) => {
                    if (!cancelled) setCapability(s.control ?? { writable: false, limits: EMPTY_LIMITS });
                })
                .catch(() => {
                    // 일시 실패로 capability를 null로 덮으면 패널이 통째로 사라지고
                    // PID 안전 훅까지 언마운트됐었다(#269). 기존 값을 유지한 채
                    // 재시도한다 — 연결 자체가 끊기면 위 분기가 정리한다.
                    if (!cancelled) timer = setTimeout(fetchCapability, CAPABILITY_RETRY_MS);
                });
        };
        fetchCapability();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [sidecarConnected, sender]);

    // 기기가 지시값을 따라오면 그 지시를 버린다 → 이후 슬라이더는 기기 실측을 따라간다.
    // 이걸 안 하면 한 번 만진 슬라이더가 영원히 내 값에 고정돼, 본체 조작반에서
    // 화력을 바꿔도 화면이 그대로다.
    useEffect(() => {
        if (!feedback) return;
        setTracking(({ desired: prev, unackPolls: prevPolls }) => {
            const settled = settledRoles(prev, feedback, CONVERGE_TOLERANCE);
            const settledSet = new Set(settled);
            const nextPolls: Partial<Record<ControlRole, number>> = {};
            for (const role of ROLES) {
                if (prev[role] == null || settledSet.has(role)) continue;
                nextPolls[role] = (prevPolls[role] ?? 0) + 1;
            }
            if (settled.length === 0) return { desired: prev, unackPolls: nextPolls };
            const nextDesired = { ...prev };
            for (const role of settled) delete nextDesired[role];
            return { desired: nextDesired, unackPolls: nextPolls };
        });
    }, [feedback]);

    const setValue = useCallback(
        (role: ControlRole, value: number) => {
            // 새 지시이므로 미반영 카운트를 되돌린다
            setTracking((t) => ({
                desired: { ...t.desired, [role]: value },
                unackPolls: { ...t.unackPolls, [role]: 0 },
            }));
            sender.queue(role, value);
        },
        [sender],
    );

    const commitNow = useCallback(() => void sender.commitNow(), [sender]);

    /** 지시했는데 기기가 계속 그대로인 role — 명령이 먹지 않았을 가능성 */
    const unacknowledged = new Set(ROLES.filter((role) => (tracking.unackPolls[role] ?? 0) >= STALE_COMMAND_POLLS));

    return {
        writable: Boolean(capability?.writable) && sidecarConnected,
        limits: capability?.limits ?? EMPTY_LIMITS,
        /** PID 지원 여부 — 같은 /status 응답에서 오므로 따로 조회하지 않는다 */
        pidCapability: capability?.pid,
        desired: tracking.desired,
        unacknowledged,
        sending,
        setValue,
        commitNow,
    };
};
