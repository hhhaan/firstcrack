import type { Machine, SidecarStatus, TemperatureReading } from '@entities/machine';
import { isSameSidecarStatus } from '@entities/machine';
import * as Sentry from '@sentry/react';
import { logger } from '@shared/lib/logger';
import { sendOsNotification } from '@shared/lib/osNotification';
import { sidecar } from '@shared/lib/sidecar';
import { useCallback, useEffect, useState } from 'react';

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

    useEffect(() => {
        if (!isActive) return;
        if (!modalOpen) {
            sidecar
                .getStatus()
                .then(setSidecarStatus)
                .catch(() => null);
        }
    }, [isActive, modalOpen]);

    useEffect(() => {
        if (!isActive || !sidecarStatus?.connected || modalOpen) {
            if (!sidecarStatus?.connected) setTemps(null);
            return;
        }

        let cancelled = false;
        const poll = async () => {
            const [nextTemps, nextStatus] = await Promise.all([
                sidecar.getTemperatures().catch(() => null),
                sidecar.getStatus().catch(() => null),
            ]);
            if (cancelled) return;
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
        setConnecting(true);
        setSidecarStatus((prev) => (prev ? { ...prev, error: null } : prev));
        try {
            const status = await sidecar.connect(machine.roasterKey, machine.connectionParams);
            setSidecarStatus(status);
            if (status.connected) {
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
            logger.capture(e, { context: 'machine connect' });
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
        const prevStatus = sidecarStatus;
        const status = await sidecar.disconnect().catch(() => null);
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
        handleConnect,
        handleDisconnect,
    };
};
