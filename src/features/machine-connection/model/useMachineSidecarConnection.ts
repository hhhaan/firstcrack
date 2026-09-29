import type { Machine, SidecarStatus, TemperatureReading } from '@entities/machine';
import { isSameSidecarStatus } from '@entities/machine';
import * as Sentry from '@sentry/react';
import { isOpaqueNetworkError } from '@shared/lib/errorMessage';
import { logger } from '@shared/lib/logger';
import { sendOsNotification } from '@shared/lib/osNotification';
import { sidecar } from '@shared/lib/sidecar';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import {
    beginMachineConnectAttempt,
    captureLinkEpoch,
    endMachineConnectAttempt,
    machineTemperatureQuality,
    noteUserMachineDisconnect,
    observeMachineLink,
    settleUserMachineDisconnect,
} from '../lib/machineLinkNotice';

const POLL_INTERVAL_MS = 3000;

type Params = {
    isActive: boolean;
    modalOpen: boolean;
    machines: Machine[];
    /** Called when sidecar reports a connected roaster so the page can auto-select it. */
    onConnectedMachineId?: (id: string) => void;
};

/**
 * Machines page sidecar connection: status fetch, temp poll, connect/disconnect.
 * Roasting-store phase handoff stays in the view (avoids features→features).
 */
export const useMachineSidecarConnection = ({ isActive, modalOpen, machines, onConnectedMachineId }: Params) => {
    const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);
    const [temps, setTemps] = useState<TemperatureReading | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [sidecarReady, setSidecarReady] = useState(false);

    // Rust는 인증된 200 응답 뒤에만 sidecar-ready를 쏜다. 마운트가 그 이벤트보다 늦으면
    // waitUntilReady 폴백이 첫 정상 상태를 대신 확인한다 (양쪽 모두 markReady로 수렴).
    useEffect(() => {
        if (!isActive) return;
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        const markReady = (status?: SidecarStatus, epoch?: number) => {
            if (cancelled) return;
            if (status) {
                setSidecarStatus(status);
                observeMachineLink({ connected: status.connected, reconnecting: Boolean(status.reconnecting) }, epoch);
            }
            setSidecarReady(true);
        };

        void listen<null>('sidecar-ready', () => {
            const epoch = captureLinkEpoch();
            void sidecar.waitUntilReady().then(
                (status) => markReady(status, epoch),
                () => null,
            );
        })
            .then((fn) => {
                // 이미 정리된 이펙트면 즉시 해제 — listen resolve가 cleanup보다 늦으면 리스너가 샌다
                if (cancelled) fn();
                else unlisten = fn;
            })
            .catch(() => null);

        if (!modalOpen) {
            const epoch = captureLinkEpoch();
            void sidecar.waitUntilReady().then(
                (status) => markReady(status, epoch),
                () => null,
            );
        }

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [isActive, modalOpen]);

    useEffect(() => {
        if (!isActive || !sidecarStatus?.connected || modalOpen) {
            if (!sidecarStatus?.connected) setTemps(null);
            return;
        }

        let cancelled = false;
        const poll = async () => {
            const epoch = captureLinkEpoch();
            const [nextTemps, nextStatus] = await Promise.all([
                sidecar.getTemperatures().catch(() => null),
                sidecar.getStatus().catch(() => null),
            ]);
            if (cancelled) return;
            observeMachineLink(
                {
                    connected: nextStatus ? nextStatus.connected : undefined,
                    reconnecting: Boolean(nextStatus?.reconnecting || nextTemps?.reconnecting),
                    observation: machineTemperatureQuality(nextTemps),
                    bt: nextTemps?.bt,
                },
                epoch,
            );
            if (nextTemps) setTemps(nextTemps);
            if (nextStatus) {
                setSidecarStatus((prev) => (isSameSidecarStatus(prev, nextStatus) ? prev : nextStatus));
            }
        };
        void poll();
        const id = setInterval(() => {
            void poll();
        }, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [isActive, sidecarStatus?.connected, modalOpen]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on connection change (user can reselect)
    useEffect(() => {
        if (!sidecarStatus?.connected || !onConnectedMachineId) return;
        const connectedId = machines.find((m) => m.roasterKey === sidecarStatus.roaster)?.id;
        if (connectedId) onConnectedMachineId(connectedId);
    }, [sidecarStatus?.connected, sidecarStatus?.roaster]);

    const handleConnect = useCallback(async (machine: Machine): Promise<SidecarStatus | null> => {
        beginMachineConnectAttempt();
        setConnecting(true);
        setSidecarStatus((prev) => (prev ? { ...prev, error: null } : prev));
        try {
            const status = await sidecar.connect(machine.roasterKey, machine.connectionParams);
            setSidecarStatus(status);
            endMachineConnectAttempt(status.connected);
            if (status.connected) {
                observeMachineLink({ connected: true, reconnecting: Boolean(status.reconnecting) });
                Sentry.addBreadcrumb({
                    category: 'hardware.connection',
                    message: `로스터 연결 성공: ${machine.name}`,
                    level: 'info',
                    data: { roasterKey: machine.roasterKey, protocol: machine.protocol },
                });
            } else if (status.error) {
                Sentry.addBreadcrumb({
                    category: 'hardware.connection',
                    message: `로스터 연결 실패: ${machine.name}`,
                    level: 'error',
                    data: { roasterKey: machine.roasterKey, protocol: machine.protocol, error: status.error },
                });
                Sentry.captureMessage(`로스터 연결 실패: ${machine.name} — ${status.error}`, 'warning');
                sendOsNotification(
                    '연결 실패',
                    `「${machine.name}」로스터에 연결할 수 없습니다. 연결 정보와 네트워크 상태를 확인해 주세요.`,
                );
            }
            return status;
        } catch (e) {
            endMachineConnectAttempt(false);
            // 프론트 타임아웃(20s)이 먼저 끊겨도 사이드카는 핸드셰이크를 계속 쥐고 있다
            // (aiohttp는 peer abort에 핸들러를 취소하지 않는다). 대기 중 connect를 취소해
            // manager 락을 돌려받아야 재시도가 즉시 가능하다.
            void sidecar.disconnect().catch(() => null);
            // sidecar가 아직 bind 전일 때의 Load failed는 재시도로 흡수하고, 소진돼도
            // 프로세스 사망은 Rust sidecar-dead가 남긴다. 401 등만 이슈로 남긴다.
            if (!isOpaqueNetworkError(e)) logger.capture(e, { context: 'machine connect' });
            Sentry.addBreadcrumb({
                category: 'hardware.connection',
                message: `로스터 연결 중 예외: ${machine.name}`,
                level: 'error',
                data: { roasterKey: machine.roasterKey, error: String(e) },
            });
            sendOsNotification(
                '연결 오류',
                `「${machine.name}」로스터 연결 중 문제가 발생했습니다. 사이드카 상태와 네트워크를 확인해 주세요.`,
            );
            return null;
        } finally {
            setConnecting(false);
        }
    }, []);

    const handleDisconnect = useCallback(async () => {
        noteUserMachineDisconnect();
        const prevStatus = sidecarStatus;
        const status = await sidecar.disconnect().catch(() => null);
        settleUserMachineDisconnect(status?.connected === false);
        if (status) setSidecarStatus(status);
        setTemps(null);
        if (prevStatus?.connected) {
            Sentry.addBreadcrumb({
                category: 'hardware.connection',
                message: '로스터 연결 해제',
                level: 'info',
                data: {
                    prevRoaster: prevStatus.roaster,
                    uptimeSec: prevStatus.uptime,
                },
            });
        }
    }, [sidecarStatus]);

    return {
        sidecarStatus,
        setSidecarStatus,
        temps,
        setTemps,
        connecting,
        sidecarReady,
        handleConnect,
        handleDisconnect,
    };
};
