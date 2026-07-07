import type { RoastersResponse, SerialPort, SidecarStatus, TemperatureReading } from '@entities/machine';
import { logger } from './logger';

export const SIDECAR_BASE = 'http://127.0.0.1:9999';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    try {
        const res = await fetch(`${SIDECAR_BASE}${path}`, {
            headers: { 'Content-Type': 'application/json' },
            ...init,
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
            logger.error(`[sidecar] ${init?.method ?? 'GET'} ${path} 실패:`, msg);
            throw new Error(msg);
        }
        return res.json() as Promise<T>;
    } catch (err) {
        if (!(err instanceof Error && err.message.startsWith('HTTP'))) {
            logger.error(`[sidecar] ${path} 네트워크 오류:`, err);
        }
        throw err;
    }
}

export const sidecar = {
    getRoasters: () => request<RoastersResponse>('/roasters'),

    getStatus: () => request<SidecarStatus>('/status'),

    connect: (roasterKey: string, params: Record<string, unknown>) =>
        request<SidecarStatus>('/connect', {
            method: 'POST',
            body: JSON.stringify({ roaster: roasterKey, ...params }),
        }),

    disconnect: () => request<SidecarStatus>('/disconnect', { method: 'POST' }),

    getTemperatures: () => request<TemperatureReading>('/temperatures'),

    updateSettings: (settings: Record<string, unknown>) =>
        request<{ ok: boolean }>('/settings', { method: 'POST', body: JSON.stringify(settings) }),

    // READY 버튼과 연동 — 가상 머신에 standby 진입 알림 (생두 투입 시뮬레이션 시작)
    enterStandby: () => request<{ ok: boolean }>('/standby', { method: 'POST' }),

    // Charge 버튼과 연동 — 시뮬레이터 타이머 리셋 + RoR 윈도우 초기화
    startRoast: () => request<{ ok: boolean }>('/start', { method: 'POST' }),

    // 로스트 종료/리셋 — 어댑터 상태를 초기화해 다음 로스트를 예열 상태에서 시작
    resetRoast: () => request<{ ok: boolean }>('/reset', { method: 'POST' }),

    getSerialPorts: () => request<SerialPort[]>('/serial-ports'),
};
